/**
 * Bearer Token module.
 * 
 * Bearer tokens allow container owners to delegate specific permissions
 * to other users. They work like JWTs with limited lifetime and scope.
 * 
 * @example
 * ```typescript
 * import { BearerToken, publicReadEACL, Table, Target, Operation } from 'neofs-sdk-ts-node';
 * 
 * // Create a token that grants read access to a friend
 * const token = new BearerToken()
 *   .setEACL(publicReadEACL(containerId))
 *   .forUser(friendUserId)
 *   .setIssuer(myUserId)
 *   .setLifetime({
 *     iat: currentEpoch,
 *     nbf: currentEpoch,
 *     exp: currentEpoch + 100n,
 *   })
 *   .sign(mySigner);
 * 
 * // Serialize and share
 * const tokenBytes = token.serialize();
 * 
 * // Later, friend can deserialize and use it
 * const receivedToken = BearerToken.deserialize(tokenBytes);
 * ```
 */

export { BearerToken, TokenLifetime } from './token';
