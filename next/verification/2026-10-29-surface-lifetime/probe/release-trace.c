#include <libavcodec/avcodec.h>
#include <libavutil/sha.h>
#include <libavutil/mem.h>
#include <CoreVideo/CoreVideo.h>
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
#include <unistd.h>
static pthread_mutex_t log_mutex=PTHREAD_MUTEX_INITIALIZER;
static FILE *log_file=NULL;
static int hash_planes(CVPixelBufferRef buffer,int width,int height,uint8_t result[64]) {
    if(CVPixelBufferLockBaseAddress(buffer,kCVPixelBufferLock_ReadOnly)!=kCVReturnSuccess)return -1;
    struct AVSHA *sha=av_sha_alloc();if(!sha){CVPixelBufferUnlockBaseAddress(buffer,kCVPixelBufferLock_ReadOnly);return -1;}
    for(int plane=0;plane<2;plane++){
        av_sha_init(sha,256);
        const uint8_t *base=CVPixelBufferGetBaseAddressOfPlane(buffer,plane);size_t stride=CVPixelBufferGetBytesPerRowOfPlane(buffer,plane);
        for(int y=0;y<(plane?height/2:height);y++)av_sha_update(sha,base+y*stride,width);
        av_sha_final(sha,result+plane*32);
    }
    av_free(sha);CVPixelBufferUnlockBaseAddress(buffer,kCVPixelBufferLock_ReadOnly);return 0;
}
typedef struct {AVBufferRef *original;CVPixelBufferRef buffer;int width,height;int64_t pts;uint8_t before[64];} Lease;
static void hex(FILE *file,const uint8_t *data){for(int i=0;i<64;i++)fprintf(file,"%02x",data[i]);}
static void release_lease(void *opaque,uint8_t *data){
    (void)data;Lease *lease=opaque;uint8_t after[64];int status=hash_planes(lease->buffer,lease->width,lease->height,after);
    pthread_mutex_lock(&log_mutex);fprintf(log_file,"{\"frame\":%lld,\"width\":%d,\"height\":%d,\"readStatus\":%d,\"before\":\"",lease->pts,lease->width,lease->height,status);hex(log_file,lease->before);fprintf(log_file,"\",\"after\":\"");if(!status)hex(log_file,after);fprintf(log_file,"\",\"unchanged\":%s}\n",!status&&!memcmp(lease->before,after,64)?"true":"false");fflush(log_file);pthread_mutex_unlock(&log_mutex);
    av_buffer_unref(&lease->original);free(lease);
}
static int trace_send_frame(AVCodecContext *encoder,const AVFrame *frame){
    if(!frame||encoder->codec_type!=AVMEDIA_TYPE_VIDEO||frame->format!=AV_PIX_FMT_VIDEOTOOLBOX)return avcodec_send_frame(encoder,frame);
    if(!frame->buf[0]||!frame->data[3])return AVERROR(EINVAL);
    if(!log_file){const char *path=getenv("JIANKU_SYNTHETIC_RELEASE_TRACE");if(!path)return AVERROR(EINVAL);int fd=open(path,O_WRONLY|O_CREAT|O_EXCL,0600);if(fd<0)return AVERROR(EIO);log_file=fdopen(fd,"w");if(!log_file){close(fd);return AVERROR(EIO);}}
    Lease *lease=calloc(1,sizeof(*lease));if(!lease)return AVERROR(ENOMEM);lease->original=av_buffer_ref(frame->buf[0]);lease->buffer=(CVPixelBufferRef)frame->data[3];lease->width=frame->width;lease->height=frame->height;lease->pts=frame->pts;
    if(!lease->original||hash_planes(lease->buffer,lease->width,lease->height,lease->before)){av_buffer_unref(&lease->original);free(lease);return AVERROR_EXTERNAL;}
    AVFrame *copy=av_frame_clone(frame);if(!copy){av_buffer_unref(&lease->original);free(lease);return AVERROR(ENOMEM);}av_buffer_unref(&copy->buf[0]);copy->buf[0]=av_buffer_create(frame->data[3],frame->buf[0]->size,release_lease,lease,0);
    if(!copy->buf[0]){av_frame_free(&copy);av_buffer_unref(&lease->original);free(lease);return AVERROR(ENOMEM);}
    int status=avcodec_send_frame(encoder,copy);av_frame_free(&copy);return status;
}
__attribute__((used)) static struct {const void *replacement;const void *replacee;} interpose __attribute__((section("__DATA,__interpose")))={(const void*)trace_send_frame,(const void*)avcodec_send_frame};
