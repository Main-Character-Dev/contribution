import type { Response } from '@contribution/contracts';
import type { ObjectValue } from './core.js';

/** The engine retains admission/lifecycle gates; domains own their argument
 * surface, maintenance read predicate, execution and retained failure context. */
export interface DomainCommand {
  fields: readonly string[];
  maintenanceAllowed(args: ObjectValue): boolean;
  handle(args: ObjectValue): Response | Promise<Response>;
  retainedFailure?(args: ObjectValue, response: Response): void;
}
