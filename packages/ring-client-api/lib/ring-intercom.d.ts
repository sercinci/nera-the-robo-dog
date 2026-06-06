import type { IntercomHandsetData, PushNotification } from './ring-types.ts';
import type { RingRestClient } from './rest-client.ts';
import { BehaviorSubject, Subject } from 'rxjs';
import { type StreamingConnectionOptions } from './streaming/webrtc-connection.ts';
import { StreamingSession } from './streaming/streaming-session.ts';
export declare class RingIntercom {
    id: number;
    deviceType: "intercom_handset_audio" | "intercom_handset_video";
    onData: BehaviorSubject<IntercomHandsetData>;
    onRequestUpdate: Subject<unknown>;
    onBatteryLevel: import("rxjs").Observable<number | null>;
    onDing: Subject<void>;
    onUnlocked: Subject<void>;
    private initialData;
    private restClient;
    constructor(initialData: IntercomHandsetData, restClient: RingRestClient);
    updateData(update: IntercomHandsetData): void;
    requestUpdate(): void;
    get data(): IntercomHandsetData;
    get name(): string;
    get isOffline(): boolean;
    get batteryLevel(): number | null;
    unlock(): Promise<import("./rest-client.ts").ExtendedResponse>;
    private createStreamingConnection;
    /**
     * Start a live AUDIO call with the intercom.
     *
     * NOTE: an audio-only intercom only provisions a live audio session while a
     * ding (incoming buzzer call) is active. Call this in response to `onDing`;
     * calling it while idle will likely fail to negotiate.
     */
    startLiveCall(options?: StreamingConnectionOptions): Promise<StreamingSession>;
    private doorbotUrl;
    subscribeToDingEvents(): Promise<void & import("./rest-client.ts").ExtendedResponse>;
    unsubscribeFromDingEvents(): Promise<void & import("./rest-client.ts").ExtendedResponse>;
    processPushNotification(notification: PushNotification): void;
}
