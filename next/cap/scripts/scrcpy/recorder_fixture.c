#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <libavformat/avformat.h>
#include "recorder.c"

#define CHECK(value) do { if (!(value)) { fprintf(stderr, "fixture failed: %s:%d %s\n", __FILE__, __LINE__, #value); exit(2); } } while (0)

static int64_t fixture_now;

sc_tick sc_tick_now(void) { return fixture_now; }

static void on_ended(struct sc_recorder *recorder, bool success, void *data) {
    (void) recorder;
    (void) success;
    (void) data;
}

static void open_sink(struct sc_packet_sink *sink, AVStream *stream) {
    AVCodecContext *ctx = avcodec_alloc_context3(avcodec_find_decoder(stream->codecpar->codec_id));
    CHECK(ctx);
    CHECK(avcodec_parameters_to_context(ctx, stream->codecpar) >= 0);
    CHECK(sink->ops->open(sink, ctx, NULL));
    AVPacket *config = av_packet_alloc();
    CHECK(config && av_new_packet(config, ctx->extradata_size) >= 0);
    memcpy(config->data, ctx->extradata, ctx->extradata_size);
    config->pts = AV_NOPTS_VALUE;
    CHECK(sink->ops->push(sink, config));
    av_packet_free(&config);
    avcodec_free_context(&ctx);
}

int main(int argc, char **argv) {
    CHECK(argc == 5);
    const char *mode = argv[3];
    int64_t video_offset = strtoll(argv[4], NULL, 10);
    AVFormatContext *input = NULL;
    CHECK(avformat_open_input(&input, argv[1], NULL, NULL) >= 0);
    CHECK(avformat_find_stream_info(input, NULL) >= 0);
    int video = av_find_best_stream(input, AVMEDIA_TYPE_VIDEO, -1, -1, NULL, 0);
    int audio = av_find_best_stream(input, AVMEDIA_TYPE_AUDIO, -1, -1, NULL, 0);
    CHECK(video >= 0);
    struct sc_recorder recorder = {0};
    const struct sc_recorder_callbacks callbacks = {.on_ended = on_ended};
    CHECK(sc_recorder_init(&recorder, argv[2], SC_RECORD_FORMAT_MP4, true,
                          audio >= 0, SC_ORIENTATION_0, &callbacks, NULL));
    CHECK(sc_recorder_open_output_file(&recorder));
    open_sink(&recorder.video_packet_sink, input->streams[video]);
    if (audio >= 0) open_sink(&recorder.audio_packet_sink, input->streams[audio]);
    CHECK(!recorder.timing.has_frame);
    AVPacket *packet = av_packet_alloc();
    CHECK(packet);
    while (av_read_frame(input, packet) >= 0) {
        if (packet->stream_index == video || packet->stream_index == audio) {
            bool is_video = packet->stream_index == video;
            AVStream *stream = input->streams[packet->stream_index];
            av_packet_rescale_ts(packet, stream->time_base, (AVRational) {1, 1000000});
            packet->pts += 10000000 + (is_video ? video_offset : 0);
            packet->dts = packet->pts;
            fixture_now = 5000000 + packet->pts - 10000000;
            struct sc_packet_sink *sink = is_video
                ? &recorder.video_packet_sink : &recorder.audio_packet_sink;
            CHECK(sink->ops->push(sink, packet));
        }
        av_packet_unref(packet);
    }
    av_packet_free(&packet);
    avformat_close_input(&input);
    CHECK(recorder.timing.has_frame);
    CHECK(recorder.timing.first_received == 5000000 + video_offset);
    fixture_now = 11000000 + video_offset;
    if (!strcmp(mode, "normal")) {
        sc_recorder_stop_normal(&recorder);
    } else if (!strcmp(mode, "eos-before-stop")) {
        recorder.video_packet_sink.ops->close(&recorder.video_packet_sink);
        sc_recorder_stop_normal(&recorder);
    } else {
        sc_recorder_stop(&recorder);
    }
    CHECK(recorder.timing.normal_stop == !strcmp(mode, "normal"));
    CHECK(sc_recorder_process_packets(&recorder));
    sc_recorder_close_output_file(&recorder);
    sc_recorder_destroy(&recorder);
    return 0;
}
