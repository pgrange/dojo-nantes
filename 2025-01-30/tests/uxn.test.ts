import { describe, expect, test } from '@jest/globals';

type Program = string
class Op { 
	opcode: number
       	rmode: boolean
	shortMode: boolean
	keepMode: boolean 

	constructor(opcode:number, rmode: boolean, shortMode: boolean, keepMode: boolean) {
	  this.opcode = opcode;
	  this.rmode = rmode;
	  this.shortMode = shortMode;
	  this.keepMode = keepMode;
	}
	pop(stack: any[]) : number {
	  if (this.shortMode) {
		  const lo = stack.pop();
		  const hi = stack.pop();
		  return ((hi << 8) + lo);
	  } else {
		  return stack.pop();
	  }
	}

	push(stack: any[], value: number) {
           if (this.shortMode) {
		   const lo = value & 0xff;
		   const hi = value >> 8;
		   stack.push(hi);
		   stack.push(lo);
	   } else { 
             stack.push(value);
	   } 
	}


}

type Stack = any[];

function parse(bits: number): Op {
    // Special case handling `JCI/JMI/JSI` instruction, which do not have any mode
    if (bits === 0x20 || bits === 0x40 || bits == 0x60) {
        return new Op(bits, false, false, false);
    }

    let rmode = (bits & 0b01000000) > 0;
    let shortMode = (bits & 0b00100000) > 0;
    let keepMode = (bits & 0b10000000) > 0;

    let mask = ((rmode) ? 0b10111111 : 0xff) & ((shortMode) ? 0b11011111 : 0xff);
    let opcode = bits;
    // Special case handling the `LIT` instruction, that doesn't have a `keep` mode
    if (opcode == 0x80 || opcode == 0xa0 || opcode == 0xc0 || opcode == 0xe0) {
        opcode = opcode & mask
    } else {
        opcode = opcode & mask & ((keepMode) ? 0b01111111 : 0xff)
    }

    return new Op(opcode, rmode, shortMode, keepMode);
}

class Uxn {
    stack: Stack
    return_stack: Stack
    devices: Devices
    program_counter: number

    constructor(devices: Devices = new Devices()) {
        this.stack = []
        this.return_stack = []
        this.devices = devices;
        this.program_counter = 0;
    }

    inc(op: Op, stack: Stack) {
        if (op.keepMode) {
            if (op.shortMode) {
                stack.push(stack[stack.length - 2]);
                stack.push(stack[stack.length - 2]);
            } else {
                stack.push(stack[stack.length - 1]);
            }
        }
        stack[stack.length - 1]++;
    }

    pop(op: Op, stack: number[]) {
        op.pop(stack);
    }

    add(op: Op, stack:number[]) {
       let lo = op.pop(stack);
       let hi = op.pop(stack);
       if (op.keepMode) {
	   op.push(stack, hi);
           op.push(stack, lo);
       } 
       op.push(stack, lo + hi);
    }

    nip(op: Op, stack : number[]) {
       let lo = op.pop(stack);
       let hi = op.pop(stack);
       if (op.keepMode) {
	   op.push(stack, hi);
           op.push(stack, lo);
       } 
       op.push(stack, lo);
    }

    swap(op: Op, stack: Stack) {
       let lo = op.pop(stack);
       let hi = op.pop(stack);
       if(op.keepMode) {
         op.push(stack, hi);
         op.push(stack, lo);
       }
       op.push(stack, lo);
       op.push(stack, hi);
    }

    lit(op: Op, program: Program, stack: Stack) {
        let pushOneByte = () => {
            this.program_counter += 1;
            let byte = program.charCodeAt(this.program_counter);
            stack.push(byte);
        }

        pushOneByte();
        if (op.shortMode) {
            pushOneByte();
        }
    }

    rot(op: Op, stack: Stack) {
        const c = op.pop(stack);
        const b = op.pop(stack);
        const a = op.pop(stack);
	op.push(stack, b);
	op.push(stack, c);
	op.push(stack, a);
    }

    peek(nbBytes: number, stack: any[], depth : number) : any[] {
        const start = stack.length - depth*nbBytes;
	      return stack.slice(start, start + nbBytes);
    }

    dup(op: Op, stack: any[]) {
      if(op.keepMode) {
        const sliceSize = (op.shortMode) ? 2 : 1;
        const bytesToDuplicate = this.peek(sliceSize, stack, 1);

	      bytesToDuplicate.forEach((a) => {
	          stack.push(a);
	      });

	      bytesToDuplicate.forEach((a) => {
	          stack.push(a);
	      });
      } else {
	 const val = op.pop(stack)
	 op.push(stack, val)
	 op.push(stack, val)
      }
    }

    ovr(op: Op, stack: any[]) {
        const sliceSize = (op.shortMode) ? 2 : 1;
        const bytesToDuplicate = this.peek(sliceSize, stack, 2);

        // FIXME: this passes the test but it's overloading peek's semantics
        // it seems the way we implement ovr (and dup) is not really conveying
        // the intended semantics of the VM, we should rather directly manupulat
        // the stack
        if (op.keepMode) {
	          this.peek(2 * sliceSize, stack, sliceSize).forEach((a) => {
	              stack.push(a);
	          });
        }

        bytesToDuplicate.forEach((b) => {
            stack.push(b);
        });

    }

    equ(op: Op, stack: any[]) {
        const sliceSize = (op.shortMode) ? 2 : 1;

        const b = op.pop(stack)
        const a = op.pop(stack)

	if (a === b) {
	  stack.push(0x01)
	} else {
	  stack.push(0x00)
	}
    }


    jmp(op: Op, stack: Stack) {
        if (op.shortMode) {
            const ret = op.pop(stack);
            this.program_counter = ret;
        } else {
            const offset = op.pop(stack);
            this.program_counter += offset + 1;
        }
    }

    jci(program: Program) {
        const cond = this.stack.pop();
	      if (cond === 0x00) {
	          this.program_counter += 2;
	      } else {
            this.jmi(program);
	      }
    }

    jmi(program: Program) {
    	  let hb = program.charCodeAt(this.program_counter + 1) << 0x08;
    	  let lb = program.charCodeAt(this.program_counter + 2);
    	  let offset = hb + lb;
    	  this.program_counter += offset;
    }

    jsi(program: Program) {
    	  let hb = program.charCodeAt(this.program_counter + 1) << 0x08;
    	  let lb = program.charCodeAt(this.program_counter + 2);
    	  let offset = hb + lb;
        let ret = this.program_counter + 3;
	      this.return_stack.push(ret >> 0x08 & 0xff);
	      this.return_stack.push(ret & 0xff);
    	  this.program_counter += offset;
    }

    emulate(program: Program) {
        // TODO: load program at address 0x0100
        // TODO: set pc at 0x100
        while (this.program_counter < program.length) {
            let op = parse(program.charCodeAt(this.program_counter));
            let stack = op.rmode ? this.return_stack : this.stack;
            switch (op.opcode) {
                case 0x00:
                    return;
                case 0x01:
                    this.inc(op, stack);
                    break;
                case 0x02:
		    this.pop(op, stack);
                    break;
                case 0x03:
                    this.nip(op, stack);
                    break;
                case 0x04:
                    this.swap(op, stack);
                    break;
                case 0x05:
                    this.rot(op, stack);
                    break;
                case 0x06:
                    this.dup(op, stack);
                    break;
                case 0x07:
                    this.ovr(op, stack);
                    break;
                case 0x08:
                    this.equ(op, stack);
                    break;
                case 0x0c:
                    this.jmp(op, stack);
                    continue;
                case 0x0e: {
                    const offset = this.stack.pop();
                    const ret = this.program_counter + 1;
                    const reth = (ret >> 0x08) & 0xff;
                    const retl = ret & 0xff;
                    this.return_stack.push(reth);
                    this.return_stack.push(retl);
                    this.program_counter += offset;
                    break;
                }
                case 0x0f:
                    const value = this.stack.pop();
                    this.return_stack.push(value);
                    break;
                case 0x17:
                    const device = this.stack.pop();
                    const val = this.stack.pop();
                    const deviceIndex = 0xf0 & device;
                    const port = 0x0f & device;
                    const selectedDevice = this.devices.getDevice(deviceIndex);
                    if (selectedDevice) {
                        selectedDevice.output(port, val);
                    }
                    break;
                case 0x18:
                    this.add(op, stack);
                    break;
                case 0x80:
                    this.lit(op, program, stack);
                    break;
		            case 0x20:
		                this.jci(program);
		                break;
		            case 0x40:
		                this.jmi(program);
		                break;
		            case 0x60:
		                this.jsi(program);
		                break;
                default:
                    throw new Error(":/");
            }
            this.program_counter += 1;
        }
    }
}

class Device {

    out: number[][] = Array(16).fill([])

    get(port: number): number[] {
        return this.out[port];
    }

    output(port: number, value: number) {
        this.out[port].unshift(value);
    }

}

enum DeviceType {
    CONSOLE = 16,
    SCREEN = 32
}

class Devices {

    devices: (Device | null)[]

    constructor() {
        this.devices = Array(16).fill(null);
    }

    private deviceIndex(deviceType: DeviceType): number {
        return deviceType >> 4;
    }

    getDevice(deviceType: DeviceType) {
        return this.devices[this.deviceIndex(deviceType)];
    }

    set console(device: Device) {
        this.devices[this.deviceIndex(DeviceType.CONSOLE)] = device;
    }
    set screen(device: Device) {
        this.devices[this.deviceIndex(DeviceType.SCREEN)] = device;
    }
}

describe('Uxn VM', () => {
    describe('bytecode', () => {
        test('emulate a LIT then a console write', () => {
            const consoleAdapter = new Device();
            const devices = new Devices();
            const uxn = new Uxn(devices);
            devices.console = consoleAdapter;

            const device = DeviceType.CONSOLE;
            const port = 8;

            // write the byte 0x43 to port 0x08 of device 0x10
            uxn.emulate(`\x80\x43\x80${String.fromCharCode(device + port)}\x17`);
            expect(consoleAdapter.get(0x08)).toStrictEqual([0x43]);
            expect(uxn.stack).toStrictEqual([]);
        });

        test('emulate a LIT then a screen write', () => {
            const screenAdapter = new Device();
            const devices = new Devices();
            const uxn = new Uxn(devices);
            devices.screen = screenAdapter;

            const device = DeviceType.SCREEN;
            const port = 7;

            // write the byte 0x43 to port 0x07 of device 0x20
            uxn.emulate(`\x80\x43\x80${String.fromCharCode(device + port)}\x17`);
            expect(screenAdapter.get(0x07)).toStrictEqual([0x43]);
        });

        ([
            ["emulate a LIT of a value", "\x80\x42", [0x42]],
            ["emulate a LIT of a value then a POP", "\x80\x43\x02", []],
            ["emulate a BRK command", "\x80\x43\x01\x00\x01", [0x44]],
            ["emulate a INC command", "\x80\x43\x01", [0x44]],
            // TODO: we don't really test INC2 here -> use overflow?
            ["emulate a INC2 command", "\xa0\x43\x43\x21", [0x43, 0x44]],
            ["emulate a INCk command", "\x80\x43\x81", [0x43, 0x44]],
            ["emulate a INC2k command", "\xa0\x43\x43\xa1", [0x43, 0x43, 0x43, 0x44]],
            ["emulate a NIP command", "\x80\x43\x80\x42\x03", [0x42]],
            ["emulate a NIP2k command", "\x80\x12\x80\x34\x80\x56\x80\x78\xa3", [0x12, 0x34, 0x56, 0x78, 0x56, 0x78]],
            ["emulate a ADD of 2 values", "\x80\x43\x80\x42\x18", [0x85]],
            ["emulate a ADD2 of 2 values", "\x80\x43\x80\x42\x80\x43\x80\x42\x38", [0x86, 0x84]],
            ["emulate a ADDk of 2 values", "\x80\x02\x80\x5d\x98", [0x02, 0x5d, 0x5f]],
            ["emulate a SWP of 2 values", "\x80\x43\x80\x42\x04", [0x42, 0x43]],
            ["emulate a SWPk of 2 values", "\x80\x12\x80\x34\x84", [0x12, 0x34, 0x34, 0x12]],
            ["emulate a SWP2k of 2 values", "\x80\x12\x80\x34\x80\x56\x80\x78\xa4", [0x12, 0x34, 0x56, 0x78, 0x56, 0x78, 0x12, 0x34]],
            ["emulate a ROT of 3 values", "\x80\x43\x80\x42\x80\x41\x05", [0x42, 0x41, 0x43]],
        ] as [string, string, number[]][]).forEach(([message, bytecode, stack]) => {
            test(message, () => {
                const uxn = new Uxn();
                uxn.emulate(bytecode);
                expect(uxn.stack).toStrictEqual(stack);
            });
        });

        test('emulate a JMP', () => {
            const uxn = new Uxn();
            uxn.emulate('\x80\x02\x0c\x80\x01\x80\x03');
            expect(uxn.stack).toStrictEqual([0x03]);
            expect(uxn.program_counter).toStrictEqual(0x07);
        });

        test('emulate a STH', () => {
            const uxn = new Uxn();
            uxn.emulate('\x80\x02\x0f');
            expect(uxn.stack).toStrictEqual([]);
            expect(uxn.return_stack).toStrictEqual([0x02]);
        });

        test('emulate a JSR', () => {
            const uxn = new Uxn();
            uxn.emulate('\x80\x00'.repeat(255) + '\x80\x01\x0e\x00\x80\x01');
            // 0x0000 : 0x80 0x00
            // ... (255 fois)
            // 0x01fe : 0x80 0x01
            // 0x0200 : 0x0e
            // 0x0201 : 0x00 <- l'addresse de cette instruction sur le return stack
            // 0x0202: 0x80 0x01
            expect(uxn.return_stack).toStrictEqual([0x02, 0x01]);
        });

        test('emulate a subroutine', () => {
            const uxn = new Uxn();
            uxn.emulate('\x80\x03\x0e\x80\x03\x00\x80\x04\x6c\x80\x05');
            expect(uxn.stack).toStrictEqual([0x04, 0x03]);
        });

        test('handle r mode for LIT', () => {
            const uxn = new Uxn();
            uxn.emulate('\xc0\x03');
            expect(uxn.return_stack).toStrictEqual([0x03]);
        });

        test('handle r mode for INC', () => {
            const uxn = new Uxn();
            uxn.emulate('\xc0\x03\x41');
            expect(uxn.return_stack).toStrictEqual([0x04]);
        });

        test('handle r + 2 + k mode for INC', () => {
            const uxn = new Uxn();
            uxn.emulate('\xe0\x03\x02\xe1');
            expect(uxn.return_stack).toStrictEqual([0x03, 0x02, 0x03, 0x03]);
        });

        test('handle short mode for LIT (LIT2)', () => {
            const uxn = new Uxn();
            uxn.emulate('\xa0\x03\x04');
            expect(uxn.stack).toStrictEqual([0x03, 0x04]);
        });

        test('handle short+return mode for LIT (LIT2r)', () => {
            const uxn = new Uxn();
            uxn.emulate('\xe0\x03\x04');
            expect(uxn.return_stack).toStrictEqual([0x03, 0x04]);
        });

        test('handle r mode for POP', () => {
            const uxn = new Uxn();
            uxn.emulate('\xc0\x03\x42');
            expect(uxn.return_stack).toStrictEqual([]);
        });

	      test('handle short mode for NIP (NIP2)', () => {
            const uxn = new Uxn();
            uxn.emulate('\x80\x12\x80\x34\x80\x56\x80\x78\x23');
            expect(uxn.stack).toStrictEqual([0x56, 0x78]);
        });

       	test('handle JCI when condition is not zero', () => {
            const uxn = new Uxn();
            uxn.emulate('\x80\x01\x20\x00\x04\x80\x02\x80\x03');
            expect(uxn.stack).toStrictEqual([0x03]);
        });

       	test('handle JCI at larger offset when condition is not zero', () => {
            const uxn = new Uxn();
            uxn.emulate('\x80\x01\x20\x00\x06\x80\x02\x00\x00\x80\x03');
            expect(uxn.stack).toStrictEqual([0x03]);
        });

     	  test('handle JCI when condition is zero', () => {
            const uxn = new Uxn();
            uxn.emulate('\x80\x00\x20\x00\x04\x80\x02\x80\x03');
            expect(uxn.stack).toStrictEqual([0x02, 0x03]);
        });

	      test('handle JMI', () => {
            const uxn = new Uxn();
            uxn.emulate('\x40\x00\x06\x80\x02\x00\x00\x80\x03');
            expect(uxn.stack).toStrictEqual([0x03]);
        });

	      test('handle JSI', () => {
            const uxn = new Uxn();
            uxn.emulate('\x60\x00\x05\x80\x02\x00\x80\x03\x6c');
            expect(uxn.stack).toStrictEqual([0x03, 0x02]);
        });

	      test('handle DUP', () => {
            const uxn = new Uxn();
            uxn.emulate('\x80\x02\x06');
            expect(uxn.stack).toStrictEqual([0x02, 0x02]);
        });

	      test('handle DUP on non empty stack', () => {
            const uxn = new Uxn();
            uxn.emulate('\x80\x02\x80\x01\x06');
            expect(uxn.stack).toStrictEqual([0x02, 0x01, 0x01]);
        });

	      test('handle DUPr', () => {
            const uxn = new Uxn();
            uxn.emulate('\xc0\x02\x46');
            expect(uxn.return_stack).toStrictEqual([0x02, 0x02]);
        });

	      test('handle DUPk', () => {
            const uxn = new Uxn();
            uxn.emulate('\x80\x02\x86');
            expect(uxn.stack).toStrictEqual([0x02, 0x02, 0x02]);
        });

	      test('handle DUP2', () => {
            const uxn = new Uxn();
            uxn.emulate('\xa0\x03\x02\x26');
            expect(uxn.stack).toStrictEqual([0x03, 0x02, 0x03, 0x02]);
        });

	      test('handle OVR', () => {
            const uxn = new Uxn();
            uxn.emulate('\x80\x12\x80\x34\x07');
            expect(uxn.stack).toStrictEqual([0x12,0x34,0x12]);
        });

	      test('handle OVR2', () => {
            const uxn = new Uxn();
            uxn.emulate('\xa0\x12\x34\xa0\x12\x34\xa0\x56\x78\x27');
            expect(uxn.stack).toStrictEqual([0x12, 0x34, 0x12, 0x34, 0x56, 0x78, 0x12, 0x34]);
        });

	      test('handle OVRk', () => {
            const uxn = new Uxn();
            uxn.emulate('\xa0\x12\x34\x87');
            expect(uxn.stack).toStrictEqual([0x12, 0x34, 0x12, 0x34, 0x12]);
        });

	test('handle EQU', () => {
            const uxn = new Uxn();
            uxn.emulate('\x80\x12\x80\x12\x08');
            expect(uxn.stack).toStrictEqual([0x01]);
	});	

	test('handle not EQU', () => {
            const uxn = new Uxn();
            uxn.emulate('\x80\x12\x80\x34\x08');
            expect(uxn.stack).toStrictEqual([0x00]);
        });

	test('handle EQU2', () => {
            const uxn = new Uxn();
            uxn.emulate('\x80\x12\x80\x34\x80\x12\x80\x34\x28');
            expect(uxn.stack).toStrictEqual([0x01]);
        });


	      // test all operations (but BRK) are implemented
	      // by implemented we mean "does something"
        [...Array(20).keys()].filter((x) => x > 0).forEach((byte) => {
            xtest (`handle 0x${byte.toString(16)} instruction`, () => {
		            const uxn = new Uxn();
		            const program = String.fromCharCode(byte);
		            uxn.emulate(program);
		            expect(uxn.program_counter).not.toStrictEqual(0);
	          });
	      });

    });
});
