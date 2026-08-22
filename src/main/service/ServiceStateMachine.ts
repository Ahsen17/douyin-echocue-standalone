import {
  SERVICE_LIFECYCLE_TRANSITIONS_V1,
  type ServiceActivity,
  type ServiceLifecycle,
  type ServiceViewState,
} from '@echocue/contracts';

export class ServiceStateInvalidTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServiceStateInvalidTransitionError';
  }
}

export interface ServiceStateTransitionOptions {
  stopReason?: ServiceViewState['stopReason'];
  recoverableError?: NonNullable<ServiceViewState['recoverableError']>;
}

export type ServiceStateListener = (state: ServiceViewState) => void;

const ACTIVITY_BY_LIFECYCLE: Record<ServiceLifecycle, ReadonlySet<ServiceActivity>> = {
  STOPPED: new Set(['IDLE']),
  GATE_CONNECTING: new Set(['GATE_CHECKING']),
  RUNNING: new Set(['LISTENING', 'RETRIEVING', 'GENERATING', 'DISPLAYING']),
};

const INITIAL_ACTIVITY_BY_LIFECYCLE: Record<ServiceLifecycle, ServiceActivity> = {
  STOPPED: 'IDLE',
  GATE_CONNECTING: 'GATE_CHECKING',
  RUNNING: 'LISTENING',
};

// Intra-RUNNING activity transitions (ATLAS §8.1).
const ACTIVITY_TRANSITIONS_V1: Record<ServiceActivity, readonly ServiceActivity[]> = {
  IDLE: [],
  GATE_CHECKING: [],
  LISTENING: ['RETRIEVING'],
  RETRIEVING: ['GENERATING', 'DISPLAYING', 'LISTENING'],
  GENERATING: ['DISPLAYING', 'LISTENING'],
  DISPLAYING: ['LISTENING'],
};

export class ServiceStateMachine {
  private lifecycle: ServiceLifecycle = 'STOPPED';
  private activity: ServiceActivity = 'IDLE';
  private stopReason?: ServiceViewState['stopReason'];
  private recoverableError?: NonNullable<ServiceViewState['recoverableError']>;
  private readonly listeners = new Set<ServiceStateListener>();

  getViewState(): ServiceViewState {
    return {
      lifecycle: this.lifecycle,
      activity: this.activity,
      ...(this.stopReason !== undefined ? { stopReason: this.stopReason } : {}),
      ...(this.recoverableError !== undefined ? { recoverableError: this.recoverableError } : {}),
    };
  }

  onChanged(listener: ServiceStateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  transitionToLifecycle(
    to: ServiceLifecycle,
    options: ServiceStateTransitionOptions = {},
  ): ServiceViewState {
    const allowed = SERVICE_LIFECYCLE_TRANSITIONS_V1[this.lifecycle] as readonly ServiceLifecycle[];
    if (!allowed.includes(to)) {
      throw new ServiceStateInvalidTransitionError(
        `illegal lifecycle transition ${this.lifecycle} -> ${to}`,
      );
    }
    this.lifecycle = to;
    this.activity = INITIAL_ACTIVITY_BY_LIFECYCLE[to];
    if (to === 'STOPPED') {
      this.stopReason = options.stopReason;
      this.recoverableError = options.recoverableError;
    } else {
      this.stopReason = undefined;
      this.recoverableError = undefined;
    }
    const state = this.getViewState();
    this.emit(state);
    return state;
  }

  setActivity(activity: ServiceActivity): ServiceViewState {
    const allowedForLifecycle = ACTIVITY_BY_LIFECYCLE[this.lifecycle];
    if (!allowedForLifecycle.has(activity)) {
      throw new ServiceStateInvalidTransitionError(
        `activity ${activity} not allowed in lifecycle ${this.lifecycle}`,
      );
    }
    if (this.lifecycle === 'RUNNING' && this.activity !== activity) {
      const next = ACTIVITY_TRANSITIONS_V1[this.activity];
      if (!next.includes(activity)) {
        throw new ServiceStateInvalidTransitionError(
          `illegal activity transition ${this.activity} -> ${activity}`,
        );
      }
    }
    if (this.activity === activity) {
      return this.getViewState();
    }
    this.activity = activity;
    const state = this.getViewState();
    this.emit(state);
    return state;
  }

  private emit(state: ServiceViewState): void {
    for (const listener of this.listeners) listener(state);
  }
}
