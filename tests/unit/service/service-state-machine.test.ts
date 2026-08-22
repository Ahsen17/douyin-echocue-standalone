import { describe, expect, it } from 'vitest';
import {
  ServiceStateInvalidTransitionError,
  ServiceStateMachine,
} from '../../../src/main/service/index.js';

describe('ServiceStateMachine', () => {
  it('starts in STOPPED/IDLE', () => {
    const machine = new ServiceStateMachine();
    expect(machine.getViewState()).toEqual({ lifecycle: 'STOPPED', activity: 'IDLE' });
  });

  it('follows the full valid lifecycle path', () => {
    const machine = new ServiceStateMachine();
    expect(machine.transitionToLifecycle('GATE_CONNECTING')).toMatchObject({
      lifecycle: 'GATE_CONNECTING',
      activity: 'GATE_CHECKING',
    });
    expect(machine.transitionToLifecycle('RUNNING')).toMatchObject({
      lifecycle: 'RUNNING',
      activity: 'LISTENING',
    });
    expect(machine.transitionToLifecycle('STOPPED', { stopReason: 'USER_STOP' })).toMatchObject({
      lifecycle: 'STOPPED',
      activity: 'IDLE',
      stopReason: 'USER_STOP',
    });
  });

  it('carries a recoverable error when stopping', () => {
    const machine = new ServiceStateMachine();
    machine.transitionToLifecycle('GATE_CONNECTING');
    const state = machine.transitionToLifecycle('STOPPED', {
      stopReason: 'SOURCE_ERROR',
      recoverableError: { code: 'E_SOURCE_UNAVAILABLE', at: '2026-08-22T12:00:00.000Z' },
    });
    expect(state.stopReason).toBe('SOURCE_ERROR');
    expect(state.recoverableError).toEqual({
      code: 'E_SOURCE_UNAVAILABLE',
      at: '2026-08-22T12:00:00.000Z',
    });
  });

  it('clears stopReason when leaving STOPPED', () => {
    const machine = new ServiceStateMachine();
    machine.transitionToLifecycle('GATE_CONNECTING');
    machine.transitionToLifecycle('STOPPED', { stopReason: 'ROOM_OFFLINE' });
    machine.transitionToLifecycle('GATE_CONNECTING');
    expect(machine.getViewState().stopReason).toBeUndefined();
  });

  it('clears recoverableError when leaving STOPPED', () => {
    const machine = new ServiceStateMachine();
    machine.transitionToLifecycle('GATE_CONNECTING');
    machine.transitionToLifecycle('STOPPED', {
      stopReason: 'SOURCE_ERROR',
      recoverableError: { code: 'E_SOURCE_UNAVAILABLE', at: '2026-08-22T12:00:00.000Z' },
    });
    machine.transitionToLifecycle('GATE_CONNECTING');
    expect(machine.getViewState().recoverableError).toBeUndefined();
  });

  it('rejects illegal lifecycle transitions', () => {
    const machine = new ServiceStateMachine();
    expect(() => machine.transitionToLifecycle('RUNNING')).toThrow(
      ServiceStateInvalidTransitionError,
    );
    expect(() => machine.transitionToLifecycle('GATE_CONNECTING')).not.toThrow();
    expect(() => machine.transitionToLifecycle('GATE_CONNECTING')).toThrow(
      ServiceStateInvalidTransitionError,
    );
    expect(() => machine.transitionToLifecycle('STOPPED')).not.toThrow();
    expect(() => machine.transitionToLifecycle('STOPPED')).toThrow(
      ServiceStateInvalidTransitionError,
    );
  });

  it('rejects activities not allowed in the current lifecycle', () => {
    const machine = new ServiceStateMachine();
    expect(() => machine.setActivity('LISTENING')).toThrow(ServiceStateInvalidTransitionError);
    machine.transitionToLifecycle('GATE_CONNECTING');
    expect(() => machine.setActivity('LISTENING')).toThrow(ServiceStateInvalidTransitionError);
    expect(() => machine.setActivity('GATE_CHECKING')).not.toThrow();
  });

  it('rejects intra-RUNNING activity jumps', () => {
    const machine = new ServiceStateMachine();
    machine.transitionToLifecycle('GATE_CONNECTING');
    machine.transitionToLifecycle('RUNNING');
    expect(() => machine.setActivity('DISPLAYING')).toThrow(ServiceStateInvalidTransitionError);
    expect(() => machine.setActivity('RETRIEVING')).not.toThrow();
    expect(() => machine.setActivity('LISTENING')).not.toThrow();
  });

  it('allows the full RUNNING activity cycle', () => {
    const machine = new ServiceStateMachine();
    machine.transitionToLifecycle('GATE_CONNECTING');
    machine.transitionToLifecycle('RUNNING');
    machine.setActivity('RETRIEVING');
    machine.setActivity('GENERATING');
    machine.setActivity('DISPLAYING');
    machine.setActivity('LISTENING');
    expect(machine.getViewState()).toMatchObject({ lifecycle: 'RUNNING', activity: 'LISTENING' });
  });

  it('notifies listeners on every change', () => {
    const machine = new ServiceStateMachine();
    const seen: string[] = [];
    machine.onChanged((state) => seen.push(`${state.lifecycle}/${state.activity}`));
    machine.transitionToLifecycle('GATE_CONNECTING');
    machine.transitionToLifecycle('RUNNING');
    expect(seen).toEqual(['GATE_CONNECTING/GATE_CHECKING', 'RUNNING/LISTENING']);
  });

  it('records a recoverable error while STOPPED', () => {
    const machine = new ServiceStateMachine();
    const state = machine.recordRecoverableError({
      code: 'E_SOURCE_UNAVAILABLE',
      at: '2026-08-22T12:00:00.000Z',
    });
    expect(state.lifecycle).toBe('STOPPED');
    expect(state.stopReason).toBe('SOURCE_ERROR');
    expect(state.recoverableError?.code).toBe('E_SOURCE_UNAVAILABLE');
  });

  it('rejects recording a recoverable error outside STOPPED', () => {
    const machine = new ServiceStateMachine();
    machine.transitionToLifecycle('GATE_CONNECTING');
    expect(() =>
      machine.recordRecoverableError({ code: 'E_SOURCE_UNAVAILABLE', at: '2026-08-22T12:00:00.000Z' }),
    ).toThrow(ServiceStateInvalidTransitionError);
  });

  it('does not broadcast when setActivity receives the same value', () => {
    const machine = new ServiceStateMachine();
    let count = 0;
    machine.onChanged(() => {
      count += 1;
    });
    machine.transitionToLifecycle('GATE_CONNECTING');
    expect(count).toBe(1);
    machine.setActivity('GATE_CHECKING');
    expect(count).toBe(1);
  });

  it('supports unsubscribing listeners', () => {
    const machine = new ServiceStateMachine();
    let count = 0;
    const unsubscribe = machine.onChanged(() => {
      count += 1;
    });
    unsubscribe();
    machine.transitionToLifecycle('GATE_CONNECTING');
    expect(count).toBe(0);
  });
});
