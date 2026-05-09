import { describe, expect, it } from 'vitest';
import {
  Table,
  publicReadEACL,
  privateEACL,
  publicEACL,
  allowUsersEACL,
  Target,
  Record,
  Filter,
  Operation,
  Action,
  Role,
  Match,
  HeaderType,
  ObjectFilters,
} from '../../../src/eacl';

describe('EACL', () => {
  const cid = new Uint8Array(32).fill(7);

  it('Table allowRead / denyWrite produce expected operations', () => {
    const t = publicReadEACL(cid);
    expect(t.containerId).toEqual(cid);
    const ops = new Set(t.records.map((r) => r.operation));
    expect(ops.has(Operation.GET)).toBe(true);
    expect(ops.has(Operation.PUT)).toBe(true);
    const deniesPut = t.records.some(
      (r) => r.action === Action.DENY && r.operation === Operation.PUT,
    );
    expect(deniesPut).toBe(true);
  });

  it('preset helpers set records', () => {
    expect(privateEACL(cid).records.length).toBeGreaterThan(0);
    expect(publicEACL(cid).records.length).toBeGreaterThan(0);
    const uid = new Uint8Array(25).fill(1);
    const t = allowUsersEACL([uid], cid);
    expect(t.records.length).toBeGreaterThan(0);
  });

  it('serialize / deserialize roundtrip', () => {
    const t = new Table(cid)
      .allow(Operation.GET, [Target.others()], [
        Filter.payloadSize(Match.NUM_LT, 1024n),
      ])
      .setVersion(2, 22);
    const bytes = t.serialize();
    const back = Table.deserialize(bytes);
    expect(back.containerId).toEqual(cid);
    expect(back.version).toEqual({ major: 2, minor: 22 });
    expect(back.records.length).toBe(t.records.length);
    expect(back.records[0].filters[0].key).toBe(ObjectFilters.PAYLOAD_SIZE);
  });

  it('clone is independent', () => {
    const t = new Table(cid).addRecord(Record.allowGet([Target.user()]));
    const c = t.clone();
    c.addRecord(Record.allowPut([Target.user()]));
    expect(t.records.length).toBe(1);
    expect(c.records.length).toBe(2);
  });

  it('Target factory methods', () => {
    expect(Target.user().role).toBe(Role.USER);
    expect(Target.others().role).toBe(Role.OTHERS);
    const u = new Uint8Array([1, 2]);
    expect(Target.userId(u).subjects).toEqual([u]);
    expect(Target.users([u]).subjects).toEqual([u]);
    expect(Target.publicKey(u).subjects).toEqual([u]);
    const cloned = Target.others().clone();
    expect(cloned.role).toBe(Role.OTHERS);
  });

  it('Filter factories', () => {
    const f = Filter.objectAttribute('k', Match.STRING_EQUAL, 'v');
    expect(f.headerType).toBe(HeaderType.OBJECT);
    expect(f.clone().key).toBe('k');
    expect(Filter.objectId('abc').value).toBe('abc');
    expect(Filter.creationEpoch(Match.NUM_GE, 3n).value).toBe('3');
  });
});
