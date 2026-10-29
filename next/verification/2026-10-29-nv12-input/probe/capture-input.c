#include <libavcodec/avcodec.h>
#include <CoreVideo/CoreVideo.h>
#include <fcntl.h>
#include <unistd.h>
#include <stdlib.h>
#include <errno.h>
static int write_all(int fd,const uint8_t *bytes,size_t count) {
    while(count){ssize_t written=write(fd,bytes,count);if(written<0&&errno==EINTR)continue;if(written<=0)return -1;bytes+=written;count-=written;}return 0;
}
static int capture_send_frame(AVCodecContext *encoder,const AVFrame *frame) {
    static int fd=-1;static int next_frame=0;
    if(frame&&encoder->codec_type==AVMEDIA_TYPE_VIDEO&&frame->format==AV_PIX_FMT_VIDEOTOOLBOX) {
        const char *path=getenv("JIANKU_SYNTHETIC_NV12_CAPTURE");if(!path)return AVERROR(EINVAL);
        if(fd<0){fd=open(path,O_WRONLY|O_CREAT|O_EXCL,0600);if(fd<0)return AVERROR(errno);}
        if(frame->pts!=next_frame||frame->width!=1280||frame->height!=720)return AVERROR(EINVAL);
        CVPixelBufferRef buffer=(CVPixelBufferRef)frame->data[3];if(CVPixelBufferLockBaseAddress(buffer,kCVPixelBufferLock_ReadOnly)!=kCVReturnSuccess)return AVERROR_EXTERNAL;
        int failed=0;
        for(int plane=0;plane<2&&!failed;plane++)for(int y=0;y<(plane?360:720);y++)if(write_all(fd,(uint8_t*)CVPixelBufferGetBaseAddressOfPlane(buffer,plane)+y*CVPixelBufferGetBytesPerRowOfPlane(buffer,plane),1280)){failed=1;break;}
        CVPixelBufferUnlockBaseAddress(buffer,kCVPixelBufferLock_ReadOnly);if(failed)return AVERROR(EIO);next_frame++;
    }
    return avcodec_send_frame(encoder,frame);
}
__attribute__((used)) static struct { const void *replacement; const void *replacee; } interpose __attribute__((section("__DATA,__interpose")))={(const void*)capture_send_frame,(const void*)avcodec_send_frame};
