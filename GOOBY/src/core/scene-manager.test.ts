import { describe, expect, it, vi } from "vitest";
import type { GameScene, SceneContext, SceneId } from "./contracts/scenes";
import { SceneManager, type SceneFactory } from "./scene-manager";

const INITIAL_CONTEXT: SceneContext = {
  viewport: { width: 390, height: 844, pixelRatio: 2 },
};

const FIRST_ID: SceneId = "home:living-room";
const SECOND_ID: SceneId = "home:kitchen";
const THIRD_ID: SceneId = "home:garden";
const UNKNOWN_ID: SceneId = "city:drive";

interface SceneOverrides {
  readonly enter?: (context: SceneContext) => void | Promise<void>;
  readonly update?: (deltaSeconds: number) => void;
  readonly resize?: (context: SceneContext) => void;
  readonly exit?: () => void | Promise<void>;
  readonly dispose?: () => void;
}

function scene(id: SceneId, overrides: SceneOverrides = {}) {
  const enter = vi.fn(overrides.enter ?? (() => undefined));
  const update = vi.fn(overrides.update ?? (() => undefined));
  const resize = vi.fn(overrides.resize ?? (() => undefined));
  const exit = vi.fn(overrides.exit ?? (() => undefined));
  const dispose = vi.fn(overrides.dispose ?? (() => undefined));
  const game: GameScene = {
    id,
    enter,
    update,
    resize,
    exit,
    dispose,
  };
  return { game, enter, update, resize, exit, dispose };
}

function managerWith(factories: ReadonlyArray<readonly [SceneId, SceneFactory]>): SceneManager {
  return new SceneManager(new Map(factories), INITIAL_CONTEXT);
}

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("SceneManager transition queue", () => {
  it("rejects an unknown scene without poisoning the next transition", async () => {
    const first = scene(FIRST_ID);
    const second = scene(SECOND_ID);
    const manager = managerWith([
      [FIRST_ID, () => first.game],
      [SECOND_ID, () => second.game],
    ]);

    await manager.goTo(FIRST_ID);
    await expect(manager.goTo(UNKNOWN_ID)).rejects.toThrow(
      `Scene is not registered: ${UNKNOWN_ID}`,
    );
    expect(manager.activeId).toBe(FIRST_ID);

    await expect(manager.goTo(SECOND_ID)).resolves.toBeUndefined();
    expect(manager.activeId).toBe(SECOND_ID);
    expect(first.exit).toHaveBeenCalledOnce();
    expect(first.dispose).toHaveBeenCalledOnce();
  });

  it("recovers from a fire-and-forget failure without an unhandled internal rejection", async () => {
    const first = scene(FIRST_ID);
    const manager = managerWith([[FIRST_ID, () => first.game]]);

    void manager.goTo(UNKNOWN_ID);
    await expect(manager.goTo(FIRST_ID)).resolves.toBeUndefined();

    expect(manager.activeId).toBe(FIRST_ID);
  });

  it("recovers after a throwing factory and tears down the previous scene once", async () => {
    const factoryFailure = new Error("factory failed");
    const first = scene(FIRST_ID);
    const second = scene(SECOND_ID);
    const manager = managerWith([
      [FIRST_ID, () => first.game],
      [THIRD_ID, () => {
        throw factoryFailure;
      }],
      [SECOND_ID, () => second.game],
    ]);

    await manager.goTo(FIRST_ID);
    await expect(manager.goTo(THIRD_ID)).rejects.toBe(factoryFailure);
    expect(manager.activeId).toBeNull();
    expect(first.exit).toHaveBeenCalledOnce();
    expect(first.dispose).toHaveBeenCalledOnce();

    await expect(manager.goTo(SECOND_ID)).resolves.toBeUndefined();
    expect(manager.activeId).toBe(SECOND_ID);
  });

  it("disposes a scene whose enter rejects and then accepts a later transition", async () => {
    const enterFailure = new Error("enter failed");
    const failed = scene(FIRST_ID, {
      enter: () => Promise.reject(enterFailure),
    });
    const second = scene(SECOND_ID);
    const manager = managerWith([
      [FIRST_ID, () => failed.game],
      [SECOND_ID, () => second.game],
    ]);

    await expect(manager.goTo(FIRST_ID)).rejects.toBe(enterFailure);
    expect(manager.activeId).toBeNull();
    expect(failed.exit).not.toHaveBeenCalled();
    expect(failed.dispose).toHaveBeenCalledOnce();

    await expect(manager.goTo(SECOND_ID)).resolves.toBeUndefined();
    expect(manager.activeId).toBe(SECOND_ID);
    expect(failed.dispose).toHaveBeenCalledOnce();
  });

  it("disposes a scene whose exit rejects and then accepts a later transition", async () => {
    const exitFailure = new Error("exit failed");
    const first = scene(FIRST_ID, {
      exit: () => Promise.reject(exitFailure),
    });
    const failedNext = scene(SECOND_ID);
    const third = scene(THIRD_ID);
    const manager = managerWith([
      [FIRST_ID, () => first.game],
      [SECOND_ID, () => failedNext.game],
      [THIRD_ID, () => third.game],
    ]);

    await manager.goTo(FIRST_ID);
    await expect(manager.goTo(SECOND_ID)).rejects.toBe(exitFailure);
    expect(manager.activeId).toBeNull();
    expect(first.exit).toHaveBeenCalledOnce();
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(failedNext.enter).not.toHaveBeenCalled();
    expect(failedNext.dispose).not.toHaveBeenCalled();

    await expect(manager.goTo(THIRD_ID)).resolves.toBeUndefined();
    expect(manager.activeId).toBe(THIRD_ID);
  });

  it("runs concurrent transition requests in strict call order", async () => {
    const enteredFirst = deferred();
    const events: string[] = [];
    const first = scene(FIRST_ID, {
      enter: async () => {
        events.push("first:enter:start");
        await enteredFirst.promise;
        events.push("first:enter:end");
      },
      exit: () => {
        events.push("first:exit");
      },
      dispose: () => {
        events.push("first:dispose");
      },
    });
    const second = scene(SECOND_ID, {
      enter: () => {
        events.push("second:enter");
      },
    });
    const manager = managerWith([
      [FIRST_ID, () => first.game],
      [SECOND_ID, () => second.game],
    ]);

    const firstTransition = manager.goTo(FIRST_ID);
    const secondTransition = manager.goTo(SECOND_ID);
    await vi.waitFor(() => {
      expect(events).toEqual(["first:enter:start"]);
    });

    enteredFirst.resolve();
    await Promise.all([firstTransition, secondTransition]);

    expect(events).toEqual([
      "first:enter:start",
      "first:enter:end",
      "first:exit",
      "first:dispose",
      "second:enter",
    ]);
    expect(manager.activeId).toBe(SECOND_ID);
  });

  it("forwards update and resize only to the active scene and retains the latest context", async () => {
    const resizedContext: SceneContext = {
      viewport: { width: 844, height: 390, pixelRatio: 1.5 },
    };
    const first = scene(FIRST_ID);
    const second = scene(SECOND_ID);
    const manager = managerWith([
      [FIRST_ID, () => first.game],
      [SECOND_ID, () => second.game],
    ]);

    manager.update(1 / 60);
    manager.resize(resizedContext);
    await manager.goTo(FIRST_ID);
    manager.update(0.25);
    manager.resize(INITIAL_CONTEXT);
    await manager.goTo(SECOND_ID);

    expect(first.enter).toHaveBeenCalledWith(resizedContext);
    expect(first.update).toHaveBeenCalledOnce();
    expect(first.update).toHaveBeenCalledWith(0.25);
    expect(first.resize).toHaveBeenCalledOnce();
    expect(first.resize).toHaveBeenCalledWith(INITIAL_CONTEXT);
    expect(second.enter).toHaveBeenCalledWith(INITIAL_CONTEXT);
    expect(second.update).not.toHaveBeenCalled();
    expect(second.resize).not.toHaveBeenCalled();
  });
});

describe("SceneManager disposal", () => {
  it("disposes the active scene once after a failed queued transition", async () => {
    const first = scene(FIRST_ID);
    const manager = managerWith([[FIRST_ID, () => first.game]]);

    await manager.goTo(FIRST_ID);
    await expect(manager.goTo(UNKNOWN_ID)).rejects.toThrow(
      `Scene is not registered: ${UNKNOWN_ID}`,
    );
    await expect(manager.dispose()).resolves.toBeUndefined();
    await expect(manager.dispose()).resolves.toBeUndefined();

    expect(manager.activeId).toBeNull();
    expect(first.exit).toHaveBeenCalledOnce();
    expect(first.dispose).toHaveBeenCalledOnce();
  });

  it("finishes resource teardown when final exit rejects and cannot resurrect a scene", async () => {
    const exitFailure = new Error("final exit failed");
    const first = scene(FIRST_ID, {
      exit: () => Promise.reject(exitFailure),
    });
    const second = scene(SECOND_ID);
    const secondFactory = vi.fn(() => second.game);
    const manager = managerWith([
      [FIRST_ID, () => first.game],
      [SECOND_ID, secondFactory],
    ]);

    await manager.goTo(FIRST_ID);
    const firstDisposal = manager.dispose();
    await expect(firstDisposal).rejects.toBe(exitFailure);
    await expect(manager.dispose()).rejects.toBe(exitFailure);
    await expect(manager.goTo(SECOND_ID)).rejects.toThrow("Scene manager is disposed");

    expect(manager.activeId).toBeNull();
    expect(first.exit).toHaveBeenCalledOnce();
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(secondFactory).not.toHaveBeenCalled();
  });
});
