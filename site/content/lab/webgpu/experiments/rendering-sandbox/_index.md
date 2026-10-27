---
title: "RenderingSandbox"
date: "2026-10-26"
lastmod: "2026-10-28"
description: "レンダリング実験環境の概要とバージョン一覧"
---

地形・天球・配置物を使って、シャドウやGIなどのレンダリング技法を検証する環境です。節目ごとに独立した版を保存し、過去の実装もそのまま動かせる形で残します。

**最新版：[RenderingSandbox v02を開く](v02/)**

v02では4カスケードのShadow Map、GGX + LambertのPBR、Octahedral MapによるSplit-Sum Specular IBLを追加しています。

v01では地球の大気散乱による天球、大気遠近法フォグ、独立したHDRトーンマッピングパスを追加し、操作UIをビューの近くへ集約しています。

v00は、地形・ZPrePass・Directional Shadow Map・Forward Shading・ピクセルレイ天球と1次SHのDiffuse SkyLightを備えた初版として保存しています。

以下から各版を開けます。開発中の版はローカルプレビューでのみ表示します。
