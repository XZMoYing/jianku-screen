#include <libavcodec/avcodec.h>
#include <CoreVideo/CoreVideo.h>
#include <fcntl.h>
#include <unistd.h>
#include <stdlib.h>
#include <errno.h>
static int metadata_send_frame(AVCodecContext *encoder,const AVFrame *frame) {
    if(frame&&encoder->codec_type==AVMEDIA_TYPE_VIDEO&&frame->format==AV_PIX_FMT_VIDEOTOOLBOX){
        CVPixelBufferRef buffer=(CVPixelBufferRef)frame->data[3];
        CVBufferSetAttachment(buffer,kCVImageBufferYCbCrMatrixKey,kCVImageBufferYCbCrMatrix_ITU_R_709_2,kCVAttachmentMode_ShouldPropagate);
        CVBufferSetAttachment(buffer,kCVImageBufferColorPrimariesKey,kCVImageBufferColorPrimaries_ITU_R_709_2,kCVAttachmentMode_ShouldPropagate);
        CVBufferSetAttachment(buffer,kCVImageBufferTransferFunctionKey,kCVImageBufferTransferFunction_ITU_R_709_2,kCVAttachmentMode_ShouldPropagate);
    }
    return avcodec_send_frame(encoder,frame);
}
__attribute__((used)) static struct { const void *replacement; const void *replacee; } interpose __attribute__((section("__DATA,__interpose")))={(const void*)metadata_send_frame,(const void*)avcodec_send_frame};
