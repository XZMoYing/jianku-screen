#include <libavformat/avformat.h>
#include <libavcodec/avcodec.h>
#include <libavutil/hwcontext.h>
#include <CoreVideo/CoreVideo.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static enum AVPixelFormat select_format(AVCodecContext *ctx, const enum AVPixelFormat *formats) {
    for (;*formats != AV_PIX_FMT_NONE;formats++) if (*formats == AV_PIX_FMT_VIDEOTOOLBOX) return *formats;
    return AV_PIX_FMT_NONE;
}
static void save_plane(const char *root, const char *track, const char *mode, int index, int plane, const char *kind, const uint8_t *bytes, size_t stride, size_t width, size_t height) {
    char path[2048];snprintf(path,sizeof(path),"%s/c-%s-%s-%d-%s-%d.bin",root,track,mode,index,kind,plane);
    FILE *file=fopen(path,"wb");if(!file)abort();
    for(size_t row=0;row<height;row++) if(fwrite(bytes+row*stride,1,width,file)!=width)abort();
    fclose(file);
}
int main(int argc, char **argv) {
    if (argc != 2) { fprintf(stderr,"Usage: ffmpeg-native OUTPUT_ROOT\n"); return 2; }
    const char *root=argv[1];
    for (int t=0;t<2;t++) {
        const char *track=t?"camera":"display";
        for (int m=0;m<3;m++) {
            const char *mode=m==0?"early":m==1?"late":"software";
            char path[2048];snprintf(path,sizeof(path),"%s/media/%s.mp4",root,track);
            AVFormatContext *input=NULL;if(avformat_open_input(&input,path,NULL,NULL)<0)abort();
            avformat_find_stream_info(input,NULL);
            int stream=av_find_best_stream(input,AVMEDIA_TYPE_VIDEO,-1,-1,NULL,0);
            AVStream *video=input->streams[stream];
            const AVCodec *codec=avcodec_find_decoder(video->codecpar->codec_id);
            AVCodecContext *decoder=avcodec_alloc_context3(codec);
            avcodec_parameters_to_context(decoder,video->codecpar);
            AVBufferRef *device=NULL;
            if(m<2 && av_hwdevice_ctx_create(&device,AV_HWDEVICE_TYPE_VIDEOTOOLBOX,NULL,NULL,0)<0)abort();
            if(m==0){decoder->get_format=select_format;decoder->hw_device_ctx=av_buffer_ref(device);}
            if(avcodec_open2(decoder,codec,NULL)<0)abort();
            if(m==1){decoder->get_format=select_format;decoder->hw_device_ctx=av_buffer_ref(device);}
            AVPacket *packet=av_packet_alloc();AVFrame *frame=av_frame_alloc();int index=0;
            while(av_read_frame(input,packet)>=0 && index<110){
                if(packet->stream_index==stream){
                    if(avcodec_send_packet(decoder,packet)<0)abort();
                    while(avcodec_receive_frame(decoder,frame)>=0){
                        if(index<110){
                            AVFrame *download=av_frame_alloc();
                            if(frame->format==AV_PIX_FMT_VIDEOTOOLBOX){
                                CVPixelBufferRef buffer=(CVPixelBufferRef)frame->data[3];
                                CVPixelBufferLockBaseAddress(buffer,kCVPixelBufferLock_ReadOnly);
                                for(int plane=0;plane<2;plane++) save_plane(root,track,mode,index,plane,"native",CVPixelBufferGetBaseAddressOfPlane(buffer,plane),CVPixelBufferGetBytesPerRowOfPlane(buffer,plane),frame->width,plane?frame->height/2:frame->height);
                                CVPixelBufferUnlockBaseAddress(buffer,kCVPixelBufferLock_ReadOnly);
                                if(av_hwframe_transfer_data(download,frame,0)<0)abort();
                            } else av_frame_ref(download,frame);
                            save_plane(root,track,mode,index,0,"cpu",download->data[0],download->linesize[0],frame->width,frame->height);
                            if(download->format==AV_PIX_FMT_NV12) save_plane(root,track,mode,index,1,"cpu",download->data[1],download->linesize[1],frame->width,frame->height/2);
                            else {
                                uint8_t *uv=malloc(frame->width*frame->height/2);
                                for(int row=0;row<frame->height/2;row++)for(int x=0;x<frame->width/2;x++){uv[row*frame->width+2*x]=download->data[1][row*download->linesize[1]+x];uv[row*frame->width+2*x+1]=download->data[2][row*download->linesize[2]+x];}
                                save_plane(root,track,mode,index,1,"cpu",uv,frame->width,frame->width,frame->height/2);free(uv);
                            }
                            av_frame_free(&download);
                        }
                        index++;av_frame_unref(frame);
                    }
                }
                av_packet_unref(packet);
            }
            fprintf(stdout,"%s %s %d libavcodec=%u\n",track,mode,index,avcodec_version());
            av_packet_free(&packet);av_frame_free(&frame);avcodec_free_context(&decoder);avformat_close_input(&input);av_buffer_unref(&device);
        }
    }
    return 0;
}
