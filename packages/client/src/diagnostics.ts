import { DRAFTROLL_ERROR_CODES, type DraftrollErrorCode } from '../../errors/src/index';

/**
 * Lifecycle states reported by a realtime room connection.
 *
 * @public
 */
export type DiceRoomConnectionState =
  | 'idle'
  | 'connecting'
  | 'authenticating'
  | 'synchronizing'
  | 'open'
  | 'reconnecting'
  | 'closed'
  | 'failed';

/**
 * One actionable recovery step associated with a connection failure.
 *
 * @public
 */
export interface DiceRoomRecoveryRecommendation {
  code: 'retry' | 'check-network' | 'check-origin' | 'provide-token' | 'refresh-token' | 'provide-password' | 'upgrade-protocol' | 'reduce-payload' | 'resolve-conflict' | 'contact-host';
  message: string;
  action: 'retry' | 'reconnect' | 'replace-token' | 'provide-password' | 'upgrade-client' | 'change-request' | 'manual';
  retryAfterMs?: number;
}

/**
 * Current connection state, failure context, and recommended recovery actions.
 *
 * @public
 */
export interface DiceRoomConnectionDiagnostic {
  state: DiceRoomConnectionState;
  attempt: number;
  changedAt: string;
  roomId: string;
  code?: DraftrollErrorCode;
  reason?: string;
  recoverable: boolean;
  retryAfterMs?: number;
  closeCode?: number;
  lastEventSequence: number;
  roundTripMs?: number;
  clockUncertaintyMs?: number;
  recommendations: readonly DiceRoomRecoveryRecommendation[];
}

/**
 * Returns recovery actions appropriate for a connection state and failure code.
 *
 * @public
 */
export function connectionRecommendations(input: {
  code?: string;
  closeCode?: number;
  retryAfterMs?: number;
  reconnectEnabled: boolean;
}): DiceRoomRecoveryRecommendation[] {
  const retry = (): DiceRoomRecoveryRecommendation => ({
    code: 'retry',
    message: input.retryAfterMs
      ? `Retry after approximately ${input.retryAfterMs} ms.`
      : 'Retry the room connection after the underlying condition is corrected.',
    action: 'retry',
    retryAfterMs: input.retryAfterMs,
  });
  switch (input.code) {
    case 'token_required':
      return [{ code: 'provide-token', message: 'Provide a room-scoped capability token.', action: 'replace-token' }];
    case 'token_expired':
    case 'token_revoked':
    case 'invalid_token':
    case 'invalid_signature':
    case 'unknown_key_id':
      return [{ code: 'refresh-token', message: 'Obtain a new room capability token from the room host.', action: 'replace-token' }];
    case 'room_password_required':
    case 'invalid_room_password':
      return [{ code: 'provide-password', message: 'Provide the current room password.', action: 'provide-password' }];
    case 'unsupported_protocol_version':
    case 'protocol_mismatch':
      return [{ code: 'upgrade-protocol', message: 'Upgrade the Draftroll client to a protocol version supported by the room.', action: 'upgrade-client' }];
    case 'payload_too_large':
    case 'message_too_large':
      return [{ code: 'reduce-payload', message: 'Reduce dice, metadata, or command size before retrying.', action: 'change-request' }];
    case 'revision_conflict':
      return [{ code: 'resolve-conflict', message: 'Refresh the roll and retry with the current revision or a merge strategy.', action: 'change-request' }];
    case DRAFTROLL_ERROR_CODES.roomConnectionFailed:
    case DRAFTROLL_ERROR_CODES.roomConnectionClosed:
      return [
        { code: 'check-network', message: 'Check network connectivity and the room WebSocket URL.', action: 'manual' },
        ...(input.reconnectEnabled ? [retry()] : []),
      ];
    case 'origin_not_allowed':
      return [{ code: 'check-origin', message: 'Ask the host to allow this browser origin.', action: 'manual' }];
    case undefined:
    default:
      if (input.closeCode === 1006) {
        return [
          { code: 'check-network', message: 'The socket closed abnormally; check connectivity, proxies, and TLS.', action: 'manual' },
          ...(input.reconnectEnabled ? [retry()] : []),
        ];
      }
      return input.reconnectEnabled ? [retry()] : [{ code: 'contact-host', message: 'Inspect the room service logs or contact the room host.', action: 'manual' }];
  }
}
