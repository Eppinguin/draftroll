export interface RecoveryTransportState {
  blocked: boolean;
  recoveryEnabled: boolean;
  socket: WebSocket | null;
  fatalReason?: string;
}
