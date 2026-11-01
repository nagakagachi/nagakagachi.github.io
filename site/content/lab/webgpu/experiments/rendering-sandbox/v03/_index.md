---
title: "RenderingSandbox v03"
date: "2026-11-01"
lastmod: "2026-11-01"
description: "プロシージャル樹木のモデリングとGPU配置・描画"
---

v03では、プロシージャルに生成した樹木を地形へ配置し、GPU駆動で描画します。

- [Rendererを開く](renderer/)：カメラ周辺からの配置生成、GPUカリング、Indirect描画、近中景CSMを確認します
- [Foliage Modelerを開く](foliage-modeler/)：樹形・幹・枝葉を編集し、共有IBとバリエーションStorage VBによるInstanced Drawを確認します

Rendererは主幹・主要枝3段、枝葉4段のLODをGPUで独立に選択します。樹木の描画半径256m、影キャスター半径384m、CSM既定256mの検証用設定としています。地形の描画範囲は最大16kmのままです。

[版一覧へ](../)
