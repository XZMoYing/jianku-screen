#include <libavcodec/avcodec.h>
#include <CoreVideo/CoreVideo.h>
#include <fcntl.h>
#include <unistd.h>
#include <stdlib.h>
#include <errno.h>
#include <string.h>
#include <stdio.h>
static unsigned copied_frames=0;
__attribute__((destructor)) static void report_count(void){fprintf(stderr,"JIANKU_SYNTHETIC_COPIED_FRAMES=%u\n",copied_frames);}
static void release_cv(void *opaque,uint8_t *data){(void)opaque;CFRelease(data);}
static int copy_send_frame(AVCodecContext *encoder,const AVFrame *frame) {
    if(!frame||encoder->codec_type!=AVMEDIA_TYPE_VIDEO||frame->format!=AV_PIX_FMT_VIDEOTOOLBOX)return avcodec_send_frame(encoder,frame);
    CVPixelBufferRef original=(CVPixelBufferRef)frame->data[3],copy=NULL;
    CFMutableDictionaryRef attrs=CFDictionaryCreateMutable(NULL,0,&kCFTypeDictionaryKeyCallBacks,&kCFTypeDictionaryValueCallBacks);CFDictionaryRef empty=CFDictionaryCreate(NULL,NULL,NULL,0,&kCFTypeDictionaryKeyCallBacks,&kCFTypeDictionaryValueCallBacks);CFDictionarySetValue(attrs,kCVPixelBufferIOSurfacePropertiesKey,empty);CFDictionarySetValue(attrs,kCVPixelBufferMetalCompatibilityKey,kCFBooleanTrue);
    CVReturn status=CVPixelBufferCreate(NULL,frame->width,frame->height,CVPixelBufferGetPixelFormatType(original),attrs,&copy);CFRelease(empty);CFRelease(attrs);if(status!=kCVReturnSuccess)return AVERROR_EXTERNAL;
    if(CVPixelBufferLockBaseAddress(original,kCVPixelBufferLock_ReadOnly)!=kCVReturnSuccess){CFRelease(copy);return AVERROR_EXTERNAL;}
    if(CVPixelBufferLockBaseAddress(copy,0)!=kCVReturnSuccess){CVPixelBufferUnlockBaseAddress(original,kCVPixelBufferLock_ReadOnly);CFRelease(copy);return AVERROR_EXTERNAL;}
    for(int plane=0;plane<2;plane++)for(int y=0;y<(plane?frame->height/2:frame->height);y++)memcpy((uint8_t*)CVPixelBufferGetBaseAddressOfPlane(copy,plane)+y*CVPixelBufferGetBytesPerRowOfPlane(copy,plane),(uint8_t*)CVPixelBufferGetBaseAddressOfPlane(original,plane)+y*CVPixelBufferGetBytesPerRowOfPlane(original,plane),frame->width);
    CVPixelBufferUnlockBaseAddress(copy,0);CVPixelBufferUnlockBaseAddress(original,kCVPixelBufferLock_ReadOnly);
    CFDictionaryRef attachments=CVBufferCopyAttachments(original,kCVAttachmentMode_ShouldPropagate);if(attachments){CVBufferSetAttachments(copy,attachments,kCVAttachmentMode_ShouldPropagate);CFRelease(attachments);}
    AVFrame *cloned=av_frame_clone(frame);if(!cloned){CFRelease(copy);return AVERROR(ENOMEM);}av_buffer_unref(&cloned->buf[0]);cloned->buf[0]=av_buffer_create((uint8_t*)copy,sizeof(copy),release_cv,NULL,0);if(!cloned->buf[0]){CFRelease(copy);av_frame_free(&cloned);return AVERROR(ENOMEM);}cloned->data[3]=(uint8_t*)copy;
    copied_frames++;int result=avcodec_send_frame(encoder,cloned);av_frame_free(&cloned);return result;
}
__attribute__((used)) static struct { const void *replacement; const void *replacee; } interpose __attribute__((section("__DATA,__interpose")))={(const void*)copy_send_frame,(const void*)avcodec_send_frame};
