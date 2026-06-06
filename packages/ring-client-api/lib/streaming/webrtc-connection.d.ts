import { ReplaySubject, Subject } from 'rxjs';
import { type BasicPeerConnection } from './peer-connection.ts';
import { Subscribed } from '../subscribed.ts';
import type { RtpPacket } from 'werift';
/**
 * Minimal shape needed to drive a streaming session. Both RingCamera and
 * RingIntercom satisfy this, so the same WebRTC flow can stream either one.
 */
export interface StreamingDevice {
    id: number;
    name: string;
    isRingEdgeEnabled?: boolean;
}
export interface StreamingConnectionOptions {
    createPeerConnection?: () => BasicPeerConnection;
    /**
     * Request an audio-only session (no video). Used for audio intercoms, which
     * provision a live audio session on a ding but have no camera.
     */
    audioOnly?: boolean;
}
export declare class WebrtcConnection extends Subscribed {
    private readonly onSessionId;
    private readonly onOfferSent;
    private readonly dialogId;
    readonly onCameraConnected: ReplaySubject<void>;
    readonly onCallAnswered: ReplaySubject<string>;
    readonly onCallEnded: ReplaySubject<void>;
    readonly onError: ReplaySubject<void>;
    readonly onMessage: ReplaySubject<{
        method: string;
    }>;
    readonly onWsOpen: import("rxjs").Observable<Event>;
    readonly onAudioRtp: Subject<RtpPacket>;
    readonly onVideoRtp: Subject<RtpPacket>;
    private readonly pc;
    private readonly ws;
    private camera;
    private readonly audioOnly;
    constructor(ticket: string, camera: StreamingDevice, options: StreamingConnectionOptions);
    private initiateCall;
    private sessionId;
    private handleMessage;
    private sendSessionMessage;
    private sendMessage;
    sendAudioPacket(rtp: RtpPacket): void;
    private activate;
    activateCameraSpeaker(): void;
    private hasEnded;
    private callEnded;
    stop(): void;
    requestKeyFrame(): void;
}
