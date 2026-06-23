declare module "nat-api" {
  export default class NatAPI {
    constructor();
    map(
      options: {
        publicPort: number;
        privatePort: number;
        protocol?: "TCP" | "UDP";
        ttl?: number;
        description?: string;
      },
      callback: (err: any) => void
    ): void;
    unmap(
      options: {
        publicPort: number;
        privatePort: number;
        protocol?: "TCP" | "UDP";
      },
      callback: (err: any) => void
    ): void;
    destroy(): void;
  }
}
