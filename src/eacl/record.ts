/**
 * EACL Record - a single access control rule.
 */

import { Action, Operation } from './enums';
import { Filter } from './filter';
import { Target } from './target';

/**
 * Record represents an access rule in NeoFS.
 * 
 * A record specifies:
 * - What operation it applies to (GET, PUT, DELETE, etc.)
 * - What action to take (ALLOW or DENY)
 * - Who it applies to (targets: roles or specific users)
 * - Optional filters to limit which resources it affects
 */
export class Record {
  private _action: Action;
  private _operation: Operation;
  private _filters: Filter[];
  private _targets: Target[];

  constructor(
    action: Action,
    operation: Operation,
    targets: Target[],
    filters: Filter[] = []
  ) {
    this._action = action;
    this._operation = operation;
    this._targets = targets;
    this._filters = filters;
  }

  /** Action to take when rule matches */
  get action(): Action {
    return this._action;
  }

  /** Operation this rule applies to */
  get operation(): Operation {
    return this._operation;
  }

  /** Targets this rule applies to */
  get targets(): Target[] {
    return this._targets;
  }

  /** Filters to limit which resources this rule affects */
  get filters(): Filter[] {
    return this._filters;
  }

  // ----------------------
  // Static Constructors
  // ----------------------

  /**
   * Create an ALLOW rule.
   */
  static allow(operation: Operation, targets: Target[], filters?: Filter[]): Record {
    return new Record(Action.ALLOW, operation, targets, filters);
  }

  /**
   * Create a DENY rule.
   */
  static deny(operation: Operation, targets: Target[], filters?: Filter[]): Record {
    return new Record(Action.DENY, operation, targets, filters);
  }

  /**
   * Allow GET operation for targets.
   */
  static allowGet(targets: Target[], filters?: Filter[]): Record {
    return Record.allow(Operation.GET, targets, filters);
  }

  /**
   * Deny GET operation for targets.
   */
  static denyGet(targets: Target[], filters?: Filter[]): Record {
    return Record.deny(Operation.GET, targets, filters);
  }

  /**
   * Allow HEAD operation for targets.
   */
  static allowHead(targets: Target[], filters?: Filter[]): Record {
    return Record.allow(Operation.HEAD, targets, filters);
  }

  /**
   * Deny HEAD operation for targets.
   */
  static denyHead(targets: Target[], filters?: Filter[]): Record {
    return Record.deny(Operation.HEAD, targets, filters);
  }

  /**
   * Allow PUT operation for targets.
   */
  static allowPut(targets: Target[], filters?: Filter[]): Record {
    return Record.allow(Operation.PUT, targets, filters);
  }

  /**
   * Deny PUT operation for targets.
   */
  static denyPut(targets: Target[], filters?: Filter[]): Record {
    return Record.deny(Operation.PUT, targets, filters);
  }

  /**
   * Allow DELETE operation for targets.
   */
  static allowDelete(targets: Target[], filters?: Filter[]): Record {
    return Record.allow(Operation.DELETE, targets, filters);
  }

  /**
   * Deny DELETE operation for targets.
   */
  static denyDelete(targets: Target[], filters?: Filter[]): Record {
    return Record.deny(Operation.DELETE, targets, filters);
  }

  /**
   * Allow SEARCH operation for targets.
   */
  static allowSearch(targets: Target[], filters?: Filter[]): Record {
    return Record.allow(Operation.SEARCH, targets, filters);
  }

  /**
   * Deny SEARCH operation for targets.
   */
  static denySearch(targets: Target[], filters?: Filter[]): Record {
    return Record.deny(Operation.SEARCH, targets, filters);
  }

  /**
   * Allow RANGE operation for targets.
   */
  static allowRange(targets: Target[], filters?: Filter[]): Record {
    return Record.allow(Operation.RANGE, targets, filters);
  }

  /**
   * Deny RANGE operation for targets.
   */
  static denyRange(targets: Target[], filters?: Filter[]): Record {
    return Record.deny(Operation.RANGE, targets, filters);
  }

  /**
   * Clone this record.
   */
  clone(): Record {
    return new Record(
      this._action,
      this._operation,
      this._targets.map(t => t.clone()),
      this._filters.map(f => f.clone())
    );
  }
}
