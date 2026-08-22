import { describe, expect, it } from 'vitest';
import { ServiceStateMachine } from '../../../src/main/service/index.js';
import { DiagnosticsSource } from '../../../src/main/telemetry/index.js';

describe('ServiceStateMachine to DiagnosticsSource wiring', () => {
  it('pushes lifecycle/activity into the diagnostics summary on every change', () => {
    const diagnostics = new DiagnosticsSource();
    const machine = new ServiceStateMachine();
    machine.onChanged((state) => diagnostics.updateLifecycle(state.lifecycle, state.activity));

    machine.transitionToLifecycle('GATE_CONNECTING');
    expect(diagnostics.getSummary()).toMatchObject({
      lifecycle: 'GATE_CONNECTING',
      activity: 'GATE_CHECKING',
    });

    machine.transitionToLifecycle('RUNNING');
    machine.setActivity('RETRIEVING');
    expect(diagnostics.getSummary()).toMatchObject({
      lifecycle: 'RUNNING',
      activity: 'RETRIEVING',
    });

    machine.transitionToLifecycle('STOPPED', { stopReason: 'ROOM_ENDED' });
    expect(diagnostics.getSummary()).toMatchObject({ lifecycle: 'STOPPED', activity: 'IDLE' });
  });
});
