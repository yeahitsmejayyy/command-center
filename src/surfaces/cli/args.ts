/**
 * Minimal argument parsing. Deliberately not a framework: the CLI has one level
 * of subcommands and a handful of flags, and a dependency to express that would
 * cost more than it saves.
 */

export interface Args {
  command: string | null;
  positional: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }

    const name = arg.slice(2);
    const next = argv[i + 1];
    // A flag takes a value only when the next token isn't another flag.
    if (next !== undefined && !next.startsWith("--")) {
      flags[name] = next;
      i++;
    } else {
      flags[name] = true;
    }
  }

  return { command: positional.shift() ?? null, positional, flags };
}

export function flagString(args: Args, name: string): string | undefined {
  const value = args.flags[name];
  return typeof value === "string" ? value : undefined;
}

export function flagBool(args: Args, name: string): boolean {
  return args.flags[name] === true || args.flags[name] === "true";
}
