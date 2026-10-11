cmake_minimum_required(VERSION 3.24)
project(JiankuScreen VERSION 0.1.6 LANGUAGES CXX OBJCXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_OSX_DEPLOYMENT_TARGET "14.0" CACHE STRING "Minimum macOS version")

find_package(Qt6 6.7 REQUIRED COMPONENTS Core Gui Widgets Quick QuickControls2)
qt_standard_project_setup(REQUIRES 6.7)
qt_policy(SET QTP0004 NEW)

if(NOT APPLE)
    message(FATAL_ERROR "The first capture adapter currently targets macOS. The shared core remains platform independent.")
endif()

qt_add_executable(jianku-screen MACOSX_BUNDLE
    src/main.cpp
    src/animation/AutomaticZoom.cpp
    src/animation/SpringSolver.cpp
    src/animation/CursorEngine.cpp
    src/animation/InputEvent.h
    src/animation/AutoFocusEngine.cpp
    src/animation/AnimationDriver.cpp
    src/animation/AnimationDriver.h
    src/capture/CaptureSource.cpp
    src/animation/AnimationSettings.cpp
    src/animation/AnimationSettings.h
    src/project/ProjectTimeline.cpp
    src/project/RecentProjects.cpp
    src/project/RecentProjects.h
    src/project/EditSidecar.cpp
    src/project/EditSidecar.h
    src/project/EditTimeline.cpp
    src/project/EditTimeline.h
    src/render/ProjectCompositor.cpp
    src/render/ProjectCompositor.h
    src/render/MotionBlur.cpp
    src/render/MotionBlur.h
    src/render/CanvasLayout.cpp
    src/render/CanvasLayout.h
    src/render/CanvasRenderer.cpp
    src/render/CanvasRenderer.h
    src/render/CanvasPreview.cpp
    src/render/CanvasPreview.h
    src/render/FocusController.cpp src/render/TimelineController.cpp
    src/render/TimelineController.h
    src/render/TimelineGeometry.cpp
    src/render/TimelineGeometry.h
    src/render/ExportController.cpp
    src/render/ExportController.h
    src/render/CropController.cpp src/render/EditorSession.cpp
    src/render/EditorSession.h
    src/render/EditorSessionRegistry.cpp
    src/render/EditorSessionRegistry.h
    src/animation/AnimationSettings.cpp
    src/animation/AnimationSettings.h
    src/capture/VideoFrameStore.cpp
    src/capture/VideoFrameStore.h
    src/capture/CaptureSource.cpp
    src/capture/CaptureSource.h
    src/settings/SettingsStore.cpp
    src/settings/SettingsStore.h
    src/settings/BackgroundLibrary.cpp
    src/settings/BackgroundLibrary.h
    src/settings/BrandAssets.cpp
    src/settings/BrandAssets.h
    src/settings/ScreenList.cpp
    src/settings/ScreenList.h
    src/mac/QuickScreenshot.mm
    src/mac/QuickScreenshot.h
    src/mac/MousePoll.mm
    src/mac/MousePoll.h
    src/mac/GlobalHotkey.mm
    src/mac/GlobalHotkey.h
    src/mac/MacWindowStyle.mm
    src/mac/MacWindowStyle.h
    src/mac/AppMenu.cpp
    src/mac/AppMenu.h
    src/mac/MacCapture.mm
    src/mac/MacCapture.h
    src/mac/MicrophoneRecorder.mm
    src/mac/MicrophoneRecorder.h
    src/mac/PointerEventRecorder.mm
    src/mac/PointerEventRecorder.h
    src/render/VideoSurface.mm
    src/render/VideoSurface.h
    src/render/RecordingPlayer.h
    src/render/RecordingPlayer.mm
    src/render/TimelineMedia.h
    src/render/TimelineMedia.cpp
    src/render/FilmstripProvider.h
    src/render/FilmstripProvider.mm
)

include(CTest)
# Optional: point the compositor test at a real recorded project directory so it
# also exercises a genuine 100+ second timeline. Left empty by default because
# recorded projects live in the user's Movies folder, not in the repository.
set(JIANKU_SMOKE_PROJECT "" CACHE PATH
    "Recorded .jianku project used by the compositor smoke test (optional)")
if(BUILD_TESTING)
    add_executable(source-crop-tests tests/SourceCropTests.cpp
        src/render/CropController.cpp src/settings/SettingsStore.cpp)
    target_link_libraries(source-crop-tests PRIVATE Qt6::Core)
    add_test(NAME source-crop COMMAND source-crop-tests)
    target_sources(jianku-screen PRIVATE tests/EditorVerification.mm)
    target_compile_definitions(jianku-screen PRIVATE JIANKU_UI_VERIFICATION)
    set_source_files_properties(tests/EditorVerification.mm PROPERTIES COMPILE_FLAGS "-fobjc-arc")
    add_executable(live-focus-tests tests/LiveFocusTests.cpp)
    target_link_libraries(live-focus-tests PRIVATE Qt6::Core)
    add_test(NAME live-focus COMMAND live-focus-tests)
    add_executable(timeline-tests tests/TimelineTests.cpp
        src/animation/AutomaticZoom.cpp src/project/ProjectTimeline.cpp)
    target_link_libraries(timeline-tests PRIVATE Qt6::Core)
    add_test(NAME timeline-boundaries COMMAND timeline-tests)

    add_executable(spring-tests tests/SpringTests.cpp src/animation/SpringSolver.cpp)
    target_link_libraries(spring-tests PRIVATE Qt6::Core)
    add_test(NAME spring-solver COMMAND spring-tests)

    add_executable(cursor-tests tests/CursorTests.cpp
        src/animation/CursorEngine.cpp src/animation/SpringSolver.cpp
        src/animation/AnimationSettings.cpp)
    target_link_libraries(cursor-tests PRIVATE Qt6::Core)
    add_test(NAME cursor-engine COMMAND cursor-tests)

    add_executable(autofocus-tests tests/AutoFocusTests.cpp
        src/animation/AutoFocusEngine.cpp src/animation/AutomaticZoom.cpp)
    target_link_libraries(autofocus-tests PRIVATE Qt6::Core)
    add_test(NAME auto-focus COMMAND autofocus-tests)

    add_executable(media-clock-tests tests/MediaClockTests.cpp src/capture/MediaClock.h)
    target_link_libraries(media-clock-tests PRIVATE Qt6::Core)
    add_test(NAME media-clock COMMAND media-clock-tests)

    add_executable(canvas-layout-tests tests/CanvasLayoutTests.cpp src/render/CanvasLayout.cpp
        src/render/CanvasRenderer.cpp)
    target_link_libraries(canvas-layout-tests PRIVATE Qt6::Core Qt6::Gui)
    add_test(NAME canvas-layout COMMAND canvas-layout-tests)

    add_executable(capture-source-tests tests/CaptureSourceTests.cpp src/capture/CaptureSource.cpp)
    target_link_libraries(capture-source-tests PRIVATE Qt6::Core)
    add_test(NAME capture-source COMMAND capture-source-tests)

    add_executable(canvas-renderer-tests tests/CanvasRendererTests.cpp
        src/render/CanvasRenderer.cpp src/render/CanvasLayout.cpp)
    target_link_libraries(canvas-renderer-tests PRIVATE Qt6::Core Qt6::Gui)
    target_compile_definitions(canvas-renderer-tests PRIVATE
        JIANKU_SOURCE_DIR="${CMAKE_CURRENT_SOURCE_DIR}")
    add_test(NAME canvas-renderer COMMAND canvas-renderer-tests)

    add_executable(edit-timeline-tests tests/EditTimelineTests.cpp src/project/EditTimeline.cpp)
    target_link_libraries(edit-timeline-tests PRIVATE Qt6::Core)
    add_test(NAME edit-timeline COMMAND edit-timeline-tests)

    # QML-side check: instantiating the real strip against a real controller is the
    # only way to catch a binding that silently renders nothing. It needs the built
    # QML module, so it depends on the app target's module directory.
    # The app compiles its QML into its own resources, so a separate test process
    # cannot import that module (its qmldir prefers a resource path that only exists
    # inside the app binary). The test therefore builds its own module from the same
    # source files — same QML, no duplication of content.
    # The aliases have to be set before the module is declared, or the resources
    # land under `ui/…` while the generated qmldir points at the bare names and
    # every type fails to resolve. The app block below sets the same properties.
    qt_add_executable(timeline-strip-tests tests/TimelineStripTests.cpp)
    set_source_files_properties(ui/FocusLane.qml PROPERTIES QT_RESOURCE_ALIAS FocusLane.qml)
    set_source_files_properties(ui/TimelineStrip.qml PROPERTIES QT_RESOURCE_ALIAS TimelineStrip.qml)
    set_source_files_properties(ui/UiButton.qml PROPERTIES QT_RESOURCE_ALIAS UiButton.qml)
    set_source_files_properties(ui/Theme.qml PROPERTIES
        QT_RESOURCE_ALIAS Theme.qml QT_QML_SINGLETON_TYPE TRUE)
    # A distinct output directory: two modules cannot share one, and sharing the app
    # module would mean sharing its qmldir, which points into the app's resources.
    qt_add_qml_module(timeline-strip-tests
        URI Jianku.Screen
        VERSION 1.0
        NO_PLUGIN
        OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/qml-test-module/Jianku/Screen"
        QML_FILES
            ui/Theme.qml
            ui/FocusLane.qml
            ui/TimelineStrip.qml
            ui/UiButton.qml
    )

    target_sources(timeline-strip-tests PRIVATE
        src/render/FocusController.cpp src/render/TimelineController.cpp src/render/TimelineGeometry.cpp
        src/render/ProjectCompositor.cpp src/project/EditTimeline.cpp
        src/project/EditSidecar.cpp
        src/render/CanvasLayout.cpp src/render/CanvasRenderer.cpp
        src/render/MotionBlur.cpp src/animation/AnimationSettings.cpp
        src/animation/AutoFocusEngine.cpp src/animation/AutomaticZoom.cpp
        src/animation/CursorEngine.cpp src/animation/SpringSolver.cpp)
    target_link_libraries(timeline-strip-tests PRIVATE
        Qt6::Core Qt6::Gui Qt6::Qml Qt6::Quick Qt6::QuickControls2)
    target_compile_definitions(timeline-strip-tests PRIVATE
        JIANKU_SOURCE_DIR="${CMAKE_CURRENT_SOURCE_DIR}")
    add_test(NAME timeline-strip COMMAND timeline-strip-tests)

    add_executable(timeline-geometry-tests tests/TimelineGeometryTests.cpp
        src/render/TimelineGeometry.cpp)
    target_link_libraries(timeline-geometry-tests PRIVATE Qt6::Core)
    add_test(NAME timeline-geometry COMMAND timeline-geometry-tests)

    # The editor's central invariant: two open recordings share no state. Worth its own
    # test rather than a UI demonstration, because the failure mode is silent.
    add_executable(editor-session-tests tests/EditorSessionTests.cpp
        src/render/CropController.cpp src/render/EditorSession.cpp src/render/FocusController.cpp src/render/TimelineController.cpp
        src/render/TimelineGeometry.cpp src/render/ExportController.cpp
        src/render/ProjectCompositor.cpp src/project/EditTimeline.cpp
        src/project/EditSidecar.cpp src/project/RecentProjects.cpp
        src/render/CanvasLayout.cpp src/render/CanvasRenderer.cpp
        src/render/MotionBlur.cpp src/animation/AnimationSettings.cpp
        src/animation/AutoFocusEngine.cpp src/animation/AutomaticZoom.cpp
        src/animation/CursorEngine.cpp src/animation/SpringSolver.cpp)
    target_sources(editor-session-tests PRIVATE src/settings/SettingsStore.cpp src/render/TimelineMedia.cpp)
    target_link_libraries(editor-session-tests PRIVATE Qt6::Core Qt6::Gui)
    target_compile_definitions(editor-session-tests PRIVATE
        JIANKU_SOURCE_DIR="${CMAKE_CURRENT_SOURCE_DIR}")
    add_test(NAME editor-session COMMAND editor-session-tests)

    add_executable(motion-blur-tests tests/MotionBlurTests.cpp src/render/MotionBlur.cpp)
    target_link_libraries(motion-blur-tests PRIVATE Qt6::Core Qt6::Gui)
    add_test(NAME motion-blur COMMAND motion-blur-tests)

    add_executable(compositor-tests tests/CompositorTests.cpp
        src/render/ProjectCompositor.cpp src/project/EditTimeline.cpp src/project/EditSidecar.cpp
        src/render/CanvasLayout.cpp
        src/render/CanvasRenderer.cpp
        src/animation/AnimationSettings.cpp src/animation/AutoFocusEngine.cpp
        src/animation/AutomaticZoom.cpp src/animation/CursorEngine.cpp
        src/animation/SpringSolver.cpp src/capture/CaptureSource.cpp
        src/render/MotionBlur.cpp)
    target_link_libraries(compositor-tests PRIVATE Qt6::Core Qt6::Gui)
    target_compile_definitions(compositor-tests PRIVATE
        JIANKU_SOURCE_DIR="${CMAKE_CURRENT_SOURCE_DIR}"
        JIANKU_SMOKE_PROJECT="${JIANKU_SMOKE_PROJECT}")
    add_test(NAME compositor COMMAND compositor-tests)
    add_executable(preview-render-tests tests/PreviewRenderTests.cpp
        src/render/ProjectCompositor.cpp src/project/EditTimeline.cpp src/project/EditSidecar.cpp
        src/render/CanvasLayout.cpp src/render/CanvasRenderer.cpp src/render/MotionBlur.cpp
        src/animation/AnimationSettings.cpp src/animation/AutoFocusEngine.cpp
        src/animation/AutomaticZoom.cpp src/animation/CursorEngine.cpp src/animation/SpringSolver.cpp)
    target_link_libraries(preview-render-tests PRIVATE Qt6::Core Qt6::Gui)
    target_compile_definitions(preview-render-tests PRIVATE JIANKU_SOURCE_DIR="${CMAKE_CURRENT_SOURCE_DIR}")
    add_test(NAME preview-render COMMAND preview-render-tests)

    add_executable(timeline-controller-tests tests/TimelineControllerTests.cpp
        src/render/FocusController.cpp src/render/TimelineController.cpp src/render/TimelineGeometry.cpp src/render/ProjectCompositor.cpp
        src/project/EditTimeline.cpp src/project/EditSidecar.cpp src/render/CanvasLayout.cpp
        src/render/CanvasRenderer.cpp src/render/MotionBlur.cpp
        src/animation/AnimationSettings.cpp src/animation/AutoFocusEngine.cpp
        src/animation/AutomaticZoom.cpp src/animation/CursorEngine.cpp
        src/animation/SpringSolver.cpp)
    target_link_libraries(timeline-controller-tests PRIVATE Qt6::Core Qt6::Gui)
    target_compile_definitions(timeline-controller-tests PRIVATE
        JIANKU_SOURCE_DIR="${CMAKE_CURRENT_SOURCE_DIR}")
    add_test(NAME timeline-controller COMMAND timeline-controller-tests)

    add_executable(export-controller-tests tests/ExportControllerTests.cpp
        src/render/ExportController.cpp src/render/ProjectCompositor.cpp
        src/project/EditSidecar.cpp
        src/project/EditTimeline.cpp
        src/render/CanvasLayout.cpp src/render/CanvasRenderer.cpp src/animation/AnimationSettings.cpp
        src/animation/AutoFocusEngine.cpp src/animation/AutomaticZoom.cpp
        src/animation/CursorEngine.cpp src/animation/SpringSolver.cpp
        src/render/MotionBlur.cpp)
    target_link_libraries(export-controller-tests PRIVATE Qt6::Core Qt6::Gui)
    target_compile_definitions(export-controller-tests PRIVATE
        JIANKU_SOURCE_DIR="${CMAKE_CURRENT_SOURCE_DIR}")
    add_test(NAME export-controller COMMAND export-controller-tests)
    set_tests_properties(export-controller PROPERTIES TIMEOUT 300)
endif()

# Offline compositor: replays a recorded project through the shared animation
# engine and canvas layout and writes a composited MP4.
qt_add_executable(jianku-compose
    src/project/EditSidecar.cpp
    src/render/ComposeMain.cpp
    src/render/ProjectCompositor.cpp
    src/render/ProjectCompositor.h
    src/project/EditTimeline.cpp
    src/project/EditTimeline.h
    src/render/MotionBlur.cpp
    src/render/MotionBlur.h
    src/render/CanvasLayout.cpp
    src/render/CanvasLayout.h
    src/render/CanvasRenderer.cpp
    src/render/CanvasRenderer.h
    src/animation/AnimationSettings.cpp
    src/animation/AnimationSettings.h
    src/animation/AutoFocusEngine.cpp
    src/animation/AutomaticZoom.cpp
    src/animation/CursorEngine.cpp
    src/animation/SpringSolver.cpp
)
target_link_libraries(jianku-compose PRIVATE Qt6::Core Qt6::Gui)
target_compile_definitions(jianku-compose PRIVATE
    JIANKU_SOURCE_DIR="${CMAKE_CURRENT_SOURCE_DIR}")

set_source_files_properties(src/mac/MacCapture.mm src/mac/QuickScreenshot.mm
    src/mac/PointerEventRecorder.mm src/mac/MicrophoneRecorder.mm
    src/mac/MousePoll.mm
    src/mac/MacWindowStyle.mm
    src/mac/GlobalHotkey.mm src/render/VideoSurface.mm src/render/RecordingPlayer.mm src/render/FilmstripProvider.mm
    PROPERTIES COMPILE_FLAGS "-fobjc-arc")

set_source_files_properties(ui/Theme.qml PROPERTIES QT_RESOURCE_ALIAS Theme.qml QT_QML_SINGLETON_TYPE TRUE)
set_source_files_properties(ui/Main.qml PROPERTIES QT_RESOURCE_ALIAS Main.qml)
set_source_files_properties(ui/OutputWindow.qml PROPERTIES QT_RESOURCE_ALIAS OutputWindow.qml)
set_source_files_properties(ui/SettingsPage.qml PROPERTIES QT_RESOURCE_ALIAS SettingsPage.qml)
set_source_files_properties(ui/IconRail.qml PROPERTIES QT_RESOURCE_ALIAS IconRail.qml)
set_source_files_properties(ui/PreviewCanvas.qml PROPERTIES QT_RESOURCE_ALIAS PreviewCanvas.qml)
set_source_files_properties(ui/PanelCard.qml PROPERTIES QT_RESOURCE_ALIAS PanelCard.qml)
set_source_files_properties(ui/RegionSelector.qml PROPERTIES QT_RESOURCE_ALIAS RegionSelector.qml)
set_source_files_properties(ui/TimelineStrip.qml PROPERTIES QT_RESOURCE_ALIAS TimelineStrip.qml)
set_source_files_properties(ui/PermissionGuide.qml PROPERTIES QT_RESOURCE_ALIAS PermissionGuide.qml)
set_source_files_properties(ui/UiButton.qml PROPERTIES QT_RESOURCE_ALIAS UiButton.qml)
set_source_files_properties(ui/UiField.qml PROPERTIES QT_RESOURCE_ALIAS UiField.qml)
set_source_files_properties(ui/UiComboBox.qml PROPERTIES QT_RESOURCE_ALIAS UiComboBox.qml)
set_source_files_properties(ui/UiSlider.qml PROPERTIES QT_RESOURCE_ALIAS UiSlider.qml)
set_source_files_properties(ui/UiToggle.qml PROPERTIES QT_RESOURCE_ALIAS UiToggle.qml)
set_source_files_properties(ui/UiSegmented.qml PROPERTIES QT_RESOURCE_ALIAS UiSegmented.qml)
set_source_files_properties(ui/UiColorField.qml PROPERTIES QT_RESOURCE_ALIAS UiColorField.qml)
# The aliases matter: without them the QML files land under `qrc:/qt/qml/Jianku/Screen/ui/`
# and `qmldir` still lists `ui/…`, so `loadFromModule` finds a module whose types point at
# a path the URL scheme does not resolve — which is exactly the "No such file or directory"
# this produced.
set_source_files_properties(ui/EditorWindow.qml PROPERTIES QT_RESOURCE_ALIAS EditorWindow.qml)
set_source_files_properties(ui/EditorTab.qml PROPERTIES QT_RESOURCE_ALIAS EditorTab.qml)
set_source_files_properties(ui/FocusLane.qml PROPERTIES QT_RESOURCE_ALIAS FocusLane.qml)
set_source_files_properties(ui/FocusInspector.qml PROPERTIES QT_RESOURCE_ALIAS FocusInspector.qml)
set_source_files_properties(ui/CropCanvas.qml PROPERTIES QT_RESOURCE_ALIAS CropCanvas.qml)
set_source_files_properties(ui/CropInspector.qml PROPERTIES QT_RESOURCE_ALIAS CropInspector.qml)

qt_add_qml_module(jianku-screen
    URI Jianku.Screen
    VERSION 1.0
    QML_FILES
        ui/Theme.qml
        ui/Main.qml
        ui/OutputWindow.qml
        ui/SettingsPage.qml
        ui/IconRail.qml
        ui/PreviewCanvas.qml
        ui/PanelCard.qml
        ui/RegionSelector.qml
        ui/TimelineStrip.qml
        ui/PermissionGuide.qml
        ui/UiButton.qml
        ui/UiField.qml
        ui/UiComboBox.qml
        ui/UiSlider.qml
        ui/UiToggle.qml
        ui/UiSegmented.qml
        ui/UiColorField.qml
        ui/EditorWindow.qml
        ui/EditorTab.qml
        ui/FocusLane.qml
        ui/FocusInspector.qml
        ui/CropCanvas.qml
        ui/CropInspector.qml
)

target_link_libraries(jianku-screen PRIVATE
    Qt6::Core Qt6::Gui Qt6::Widgets Qt6::Quick Qt6::QuickControls2
    "-framework ScreenCaptureKit"
    "-framework CoreMedia"
    "-framework CoreVideo"
    "-framework CoreGraphics"
    "-framework Metal"
    "-framework Foundation"
    "-framework Carbon"
    "-framework AppKit"
    "-framework AVFoundation"
)

set_target_properties(jianku-screen PROPERTIES
    OUTPUT_NAME "Jianku Screen"
    MACOSX_BUNDLE_BUNDLE_NAME "Jianku Screen"
    MACOSX_BUNDLE_GUI_IDENTIFIER "com.jianku.screen"
    MACOSX_BUNDLE_INFO_PLIST "${CMAKE_CURRENT_SOURCE_DIR}/src/mac/Info.plist.in"
    # The Finder/Dock icon. Regenerate the assets with scripts/build-branding.py
    # after replacing logo.png; the .icns is committed so a build never depends on
    # the script having been run.
    MACOSX_BUNDLE_ICON_FILE "JiankuScreen.icns"
)

target_compile_definitions(jianku-screen PRIVATE
    JIANKU_SOURCE_DIR="${CMAKE_CURRENT_SOURCE_DIR}")

add_custom_command(TARGET jianku-screen POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_directory
        "${CMAKE_CURRENT_SOURCE_DIR}/assets/backgrounds"
        "$<TARGET_BUNDLE_CONTENT_DIR:jianku-screen>/Resources/backgrounds"
    COMMENT "Bundling background assets")

# The app icon, the in-app marks and the menu bar template. They live in Resources
# rather than in the QML resource system so the .icns can be handed to the bundle
# as a file, and so the UI can load the marks by path like the backgrounds.
add_custom_command(TARGET jianku-screen POST_BUILD
    # The .icns goes to the Resources root, which is where CFBundleIconFile looks for
    # it; the PNG marks live in a subdirectory because they are only ever loaded by
    # path from the app itself.
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${CMAKE_CURRENT_SOURCE_DIR}/assets/branding/JiankuScreen.icns"
        "$<TARGET_BUNDLE_CONTENT_DIR:jianku-screen>/Resources/JiankuScreen.icns"
    COMMAND ${CMAKE_COMMAND} -E make_directory
        "$<TARGET_BUNDLE_CONTENT_DIR:jianku-screen>/Resources/branding"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${CMAKE_CURRENT_SOURCE_DIR}/assets/branding/jianku-menubar.png"
        "${CMAKE_CURRENT_SOURCE_DIR}/assets/branding/jianku-mark-22.png"
        "${CMAKE_CURRENT_SOURCE_DIR}/assets/branding/jianku-mark-48.png"
        "${CMAKE_CURRENT_SOURCE_DIR}/assets/branding/jianku-mark-128.png"
        "$<TARGET_BUNDLE_CONTENT_DIR:jianku-screen>/Resources/branding/"
    COMMENT "Bundling icon assets")

add_custom_command(TARGET jianku-screen POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory "$<TARGET_BUNDLE_CONTENT_DIR:jianku-screen>/Resources/Licenses"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different "${CMAKE_CURRENT_SOURCE_DIR}/third_party/dogsc/LICENSE"
        "$<TARGET_BUNDLE_CONTENT_DIR:jianku-screen>/Resources/Licenses/DogSC-MIT.txt"
    COMMENT "Bundling third-party notices")

# Re-sign with a stable identity so TCC permissions survive rebuilds.
add_custom_command(TARGET jianku-screen POST_BUILD
    COMMAND /bin/sh "${CMAKE_CURRENT_SOURCE_DIR}/scripts/sign.sh" "$<TARGET_BUNDLE_DIR:jianku-screen>"
    COMMENT "Signing app with stable JiankuDev identity")
