---
title: " MainViewのViewportSizeとカメラ位置,カメラ姿勢の取得"
date: "2021-11-06T20:13:54+09:00"
draft: false
url: "/entry/2021/11/06/201354/"
categories: ["UE4", "UE4", "UE4", "C++", "UE4", "UnrealC++"]
hatena_author: "nagakagachi"
hatena_original_url: "https://nagakagachi.hatenablog.com/entry/2021/11/06/201354"
hatena_basename: "2021/11/06/201354"
math: false
---

<p><a class="keyword" href="http://d.hatena.ne.jp/keyword/UE4">UE4</a>.27で確認</p>


```C++
// Get Current View Info (EditorMode, PlayMode).
auto GetCurrentViewportInfo = [](const UWorld* world, FVector2D& out_viewport_size, FVector& out_view_location, FQuat& out_view_quat)
{
    if (!world)
        return;

#if WITH_EDITOR
    if (world->WorldType == EWorldType::Editor || world->WorldType == EWorldType::EditorPreview)
    {
        // EditorMode.
        // Use First Editor Viewport.
        for (FLevelEditorViewportClient* level_viewport_clients : GEditor->GetLevelViewportClients())
        {
            if (level_viewport_clients && level_viewport_clients->IsPerspective())
            {
                out_viewport_size = level_viewport_clients->Viewport->GetSizeXY();
                out_view_location = level_viewport_clients->GetViewLocation();
                out_view_quat = level_viewport_clients->GetViewRotation().Quaternion();
                break;
            }
        }
    }
    else
#endif
    {
        // Non EditorMode.
        // Use First PlayerCamera.
        if (auto* camera_manager = UGameplayStatics::GetPlayerCameraManager(world, 0))
        {
            GEngine->GameViewport->GetViewportSize(out_viewport_size);
            out_view_location = camera_manager->GetCameraLocation();
            out_view_quat = camera_manager->GetCameraRotation().Quaternion();
        }
    }

    return;
};

const UWorld* world = [ワールド];
FVector2D out_viewport_size;
FVector out_view_location;
FQuat out_view_quat;
// Get Info.
GetCurrentViewportInfo(world, out_viewport_size, out_view_location, out_view_quat);
```

---

[元のはてなブログ記事](https://nagakagachi.hatenablog.com/entry/2021/11/06/201354)
