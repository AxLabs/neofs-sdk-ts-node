/**
 * EACL (Extended Access Control List) module.
 * 
 * @example
 * ```typescript
 * import { 
 *   Table, Target, Record, Filter, 
 *   Operation, Action, Match,
 *   publicReadEACL 
 * } from 'neofs-sdk-ts-node';
 * 
 * // Quick preset for public read
 * const eacl = publicReadEACL(containerId);
 * 
 * // Or build custom rules
 * const customEacl = new Table(containerId)
 *   // Allow others to read
 *   .allowRead([Target.others()])
 *   // Allow specific user to write
 *   .allow(Operation.PUT, [Target.userId(friendId)])
 *   // Deny deletion by others
 *   .deny(Operation.DELETE, [Target.others()])
 *   // Allow access only to objects smaller than 10MB
 *   .allow(Operation.GET, [Target.others()], [
 *     Filter.payloadSize(Match.NUM_LT, 10n * 1024n * 1024n)
 *   ]);
 * 
 * // Serialize for API
 * const bytes = customEacl.serialize();
 * await client.container().setExtendedACL(eacl.toProto());
 * ```
 */

export { Action, Operation, Role, Match, HeaderType, ObjectFilters } from './enums';
export { Filter } from './filter';
export { Target } from './target';
export { Record } from './record';
export { 
  Table, 
  publicReadEACL, 
  privateEACL, 
  publicEACL, 
  allowUsersEACL 
} from './table';
