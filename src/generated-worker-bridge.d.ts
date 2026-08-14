export {};

declare global {
  interface Worker {
    /** Internal marker used only while installing the generated-dice worker bridge. */
    prototype: Worker;
  }
}
