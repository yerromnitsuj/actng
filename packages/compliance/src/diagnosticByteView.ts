import { ComplianceError } from "./errors.js";

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const byteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")!.get!;
const byteOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset")!.get!;
const bufferOf = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")!.get!;
const arrayBufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!
  .get!;
const resizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")?.get;

/** Borrow a synchronous intrinsic-only view; callers copy before yielding. */
export function diagnosticByteView(chunk: unknown): Uint8Array<ArrayBuffer> {
  const fail = (message: string): never => {
    throw new ComplianceError("BAD_DIAGNOSTIC_RUN", message, "$.chunks");
  };
  if (!(chunk instanceof Uint8Array) || !ArrayBuffer.isView(chunk))
    fail("Artifact chunks must be Uint8Array values");
  const buffer = bufferOf.call(chunk) as ArrayBuffer;
  try {
    arrayBufferLength.call(buffer);
  } catch {
    fail("Shared artifact buffers cannot provide a stable byte snapshot");
  }
  if (resizable?.call(buffer))
    fail("Resizable artifact buffers cannot provide a stable byte snapshot");
  return new Uint8Array(buffer, byteOffset.call(chunk), byteLength.call(chunk));
}
