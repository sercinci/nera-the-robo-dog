import { RtpPacket } from 'werift';
import { ReplaySubject, Subject } from 'rxjs';
import type { StreamingDevice, WebrtcConnection } from './webrtc-connection.ts';
import { Subscribed } from '../subscribed.ts';
type SpawnInput = string | number;
export interface FfmpegOptions {
    input?: SpawnInput[];
    video?: SpawnInput[] | false;
    audio?: SpawnInput[];
    stdoutCallback?: (data: Buffer) => void;
    output: SpawnInput[];
}
export declare class StreamingSession extends Subscribed {
    readonly onCallEnded: ReplaySubject<void>;
    private readonly onUsingOpus;
    readonly onVideoRtp: Subject<RtpPacket>;
    readonly onAudioRtp: Subject<RtpPacket>;
    private readonly audioSplitter;
    private readonly videoSplitter;
    private readonly returnAudioSplitter;
    private readonly camera;
    private connection;
    constructor(camera: StreamingDevice, connection: WebrtcConnection);
    private bindToConnection;
    /**
     * @deprecated
     * activate will be removed in the future. Please use requestKeyFrame if you want to explicitly request an initial key frame
     */
    activate(): void;
    cameraSpeakerActivated: boolean;
    activateCameraSpeaker(): void;
    reservePort(bufferPorts?: number): Promise<number>;
    get isUsingOpus(): Promise<boolean>;
    startTranscoding(ffmpegOptions: FfmpegOptions): Promise<void>;
    transcodeReturnAudio(ffmpegOptions: {
        /** ffmpeg input args (e.g. a file path or URL). */
        input?: SpawnInput[];
        /**
         * A readable audio stream (e.g. live TTS output) piped to ffmpeg's stdin.
         * When provided, the input defaults to `pipe:0`. ffmpeg sniffs the
         * container/codec, so feed it mp3/wav/ogg (not headerless raw PCM unless
         * you also pass matching `input` format flags).
         */
        inputStream?: NodeJS.ReadableStream;
        /**
         * End the whole call when this audio finishes playing. Default true
         * (camera behaviour). Set false to keep the call open for follow-up audio
         * — e.g. a multi-turn intercom conversation.
         */
        endCallOnFinish?: boolean;
        /** Called when this audio finishes streaming (the ffmpeg process exits). */
        onFinished?: () => void;
    }): Promise<void>;
    private hasEnded;
    private callEnded;
    stop(): void;
    sendAudioPacket(rtp: RtpPacket): void;
    requestKeyFrame(): void;
}
export {};
