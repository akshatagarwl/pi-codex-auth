import { Effect, Predicate, Schedule } from "effect";
import lockfile from "proper-lockfile";

import { PiAuthLockFailed } from "./errors.js";

const PI_LOCK_STALE_MILLIS = 30_000;

const isHeldByAnother = (cause: unknown) =>
  Predicate.hasProperty(cause, "code") && cause.code === "ELOCKED";

const whileHeldForUpTo30Seconds = Schedule.exponential("10 millis").pipe(
  Schedule.jittered,
  Schedule.upTo({ duration: "30 seconds" })
);

const acquire = (file: string, compromised: { cause?: unknown }) =>
  Effect.tryPromise({
    catch: (cause) =>
      new PiAuthLockFailed({
        file,
        held: isHeldByAnother(cause),
        reason: String(cause),
      }),
    // oxlint-disable-next-line typescript/promise-function-async -- proper-lockfile returns the release function through a Promise.
    try: () =>
      lockfile.lock(file, {
        onCompromised: (cause) => {
          compromised.cause = cause;
        },
        realpath: false,
        retries: 0,
        stale: PI_LOCK_STALE_MILLIS,
      }),
  }).pipe(
    Effect.retry({
      schedule: whileHeldForUpTo30Seconds,
      while: (failure) => failure.held,
    })
  );

const failIfCompromised = (file: string, compromised: { cause?: unknown }) =>
  compromised.cause === undefined
    ? Effect.void
    : Effect.fail(
        new PiAuthLockFailed({
          file,
          held: false,
          reason: `lock compromised: ${String(compromised.cause)}`,
        })
      );

export const withPiAuthLock = <A, E, R>(
  file: string,
  work: Effect.Effect<A, E, R>
) =>
  Effect.gen(function* underPiAuthLock() {
    const compromised: { cause?: unknown } = {};
    yield* Effect.acquireRelease(acquire(file, compromised), (release) =>
      Effect.promise(() => release()).pipe(Effect.ignore)
    );
    yield* failIfCompromised(file, compromised);
    const result = yield* work;
    yield* failIfCompromised(file, compromised);

    return result;
  }).pipe(Effect.scoped);
