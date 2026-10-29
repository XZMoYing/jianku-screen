#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/opt.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#define CHECK(call) do { int call_status=(call); if(call_status<0){char error[256];av_strerror(call_status,error,sizeof(error));fprintf(stderr,"%s: %s\n",#call,error);exit(2);} } while(0)
static void drain(AVCodecContext *encoder, AVFormatContext *output, AVStream *stream) {
    AVPacket *packet=av_packet_alloc();
    for (;;) {
        int result=avcodec_receive_packet(encoder,packet);
        if(result==AVERROR(EAGAIN)||result==AVERROR_EOF)break;
        CHECK(result);
        av_packet_rescale_ts(packet,encoder->time_base,stream->time_base);
        packet->stream_index=stream->index;
        CHECK(av_interleaved_write_frame(output,packet));
        av_packet_unref(packet);
    }
    av_packet_free(&packet);
}
int main(int argc,char **argv) {
    if(argc!=3)return 1;
    const int width=1280,height=720,count=540;
    FILE *input=fopen(argv[1],"rb");if(!input)return 2;
    AVFrame **frames=calloc(count,sizeof(*frames));
    for(int n=0;n<count;n++) {
        frames[n]=av_frame_alloc();AVFrame *frame=frames[n];frame->format=AV_PIX_FMT_NV12;frame->width=width;frame->height=height;frame->pts=n;
        CHECK(av_frame_get_buffer(frame,32));
        for(int plane=0;plane<2;plane++)for(int y=0;y<(plane?height/2:height);y++)if(fread(frame->data[plane]+y*frame->linesize[plane],1,width,input)!=width)return 3;
    }
    if(fgetc(input)!=EOF)return 3;fclose(input);
    const AVCodec *codec=avcodec_find_encoder_by_name("h264_videotoolbox");if(!codec)return 4;
    AVCodecContext *encoder=avcodec_alloc_context3(codec);
    encoder->width=width;encoder->height=height;encoder->pix_fmt=AV_PIX_FMT_NV12;encoder->time_base=(AVRational){1,60};encoder->framerate=(AVRational){60,1};encoder->thread_count=8;
    encoder->colorspace=AVCOL_SPC_BT709;encoder->color_range=AVCOL_RANGE_MPEG;encoder->color_primaries=AVCOL_PRI_BT709;encoder->color_trc=AVCOL_TRC_BT709;
    encoder->bit_rate=11059200;encoder->rc_max_rate=16588800;
    AVDictionary *options=NULL;av_dict_set(&options,"realtime","false",0);av_dict_set(&options,"profile","main",0);av_dict_set(&options,"allow_sw","0",0);
    CHECK(avcodec_open2(encoder,codec,&options));av_dict_free(&options);
    AVFormatContext *output=NULL;CHECK(avformat_alloc_output_context2(&output,NULL,"mp4",argv[2]));
    AVStream *stream=avformat_new_stream(output,codec);if(!stream)return 4;stream->time_base=(AVRational){1,90000};stream->r_frame_rate=encoder->framerate;CHECK(avcodec_parameters_from_context(stream->codecpar,encoder));
    CHECK(avio_open(&output->pb,argv[2],AVIO_FLAG_WRITE));CHECK(avformat_write_header(output,NULL));
    for(int n=0;n<count;n++){CHECK(avcodec_send_frame(encoder,frames[n]));drain(encoder,output,stream);}
    CHECK(avcodec_send_frame(encoder,NULL));drain(encoder,output,stream);CHECK(av_write_trailer(output));
    for(int n=0;n<count;n++)av_frame_free(&frames[n]);free(frames);avcodec_free_context(&encoder);CHECK(avio_closep(&output->pb));avformat_free_context(output);
    printf("libavcodec=%s; frames=540; all CPU NV12 frames held immutable until encoder flush\n",av_version_info());return 0;
}
