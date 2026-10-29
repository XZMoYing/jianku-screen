#include <libavcodec/avcodec.h>
#include <CoreVideo/CoreVideo.h>
#include <IOSurface/IOSurface.h>
#include <stdio.h>
#include <libavutil/sha.h>
#include <libavutil/mem.h>
#include <string.h>
#include <fcntl.h>
#include <unistd.h>
#include <stdlib.h>
#include <errno.h>
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
static void hex(FILE *file,const uint8_t *data){for(int i=0;i<64;i++)fprintf(file,"%02x",data[i]);}
static int publish_send_frame(AVCodecContext *encoder,const AVFrame *frame){
    static FILE *log_file=NULL;
    if(frame&&encoder->codec_type==AVMEDIA_TYPE_VIDEO&&frame->format==AV_PIX_FMT_VIDEOTOOLBOX){
        if(!log_file){const char *path=getenv("JIANKU_SYNTHETIC_SEED_TRACE");if(!path)return AVERROR(EINVAL);int fd=open(path,O_WRONLY|O_CREAT|O_EXCL,0600);if(fd<0)return AVERROR(EIO);log_file=fdopen(fd,"w");if(!log_file){close(fd);return AVERROR(EIO);}}
        CVPixelBufferRef buffer=(CVPixelBufferRef)frame->data[3];IOSurfaceRef surface=CVPixelBufferGetIOSurface(buffer);if(!surface)return AVERROR_EXTERNAL;
        uint8_t before_hash[64],after_hash[64];if(hash_planes(buffer,frame->width,frame->height,before_hash))return AVERROR_EXTERNAL;
        uint32_t before=IOSurfaceGetSeed(surface),locked=0,after=0;
        kern_return_t status=IOSurfaceLock(surface,0,&locked);if(status!=KERN_SUCCESS)return AVERROR_EXTERNAL;status=IOSurfaceUnlock(surface,0,&after);if(status!=KERN_SUCCESS)return AVERROR_EXTERNAL;
        if(hash_planes(buffer,frame->width,frame->height,after_hash))return AVERROR_EXTERNAL;
        fprintf(log_file,"{\"frame\":%lld,\"before\":%u,\"locked\":%u,\"after\":%u,\"beforeHash\":\"",frame->pts,before,locked,after);hex(log_file,before_hash);fprintf(log_file,"\",\"afterHash\":\"");hex(log_file,after_hash);fprintf(log_file,"\",\"unchanged\":%s}\n",!memcmp(before_hash,after_hash,64)?"true":"false");fflush(log_file);
    }
    return avcodec_send_frame(encoder,frame);
}
__attribute__((used)) static struct { const void *replacement; const void *replacee; } interpose __attribute__((section("__DATA,__interpose")))={(const void*)publish_send_frame,(const void*)avcodec_send_frame};
