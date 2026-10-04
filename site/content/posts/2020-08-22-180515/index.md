---
title: "Voxel Mesh化手法についてメモ( Voxel Meshing )"
date: "2020-08-22T18:05:15+09:00"
draft: false
url: "/entry/2020/08/22/180515/"
categories: ["Graphics", "数学", "最適化", "Voxel", "Mesh"]
hatena_author: "nagakagachi"
hatena_original_url: "https://nagakagachi.hatenablog.com/entry/2020/08/22/180515"
hatena_basename: "2020/08/22/180515"
math: false
---

SDFなどのVoxelからMeshを生成する手法のメモ。  
  
もとのSDFのセルと、Mesh化で管理されるVoxelは一致しないので注意。  
  
もとのSDFのセル中心を頂点とするようなVoxel上でMesh化が実行される。



<div class="section">
    

### Marching  Cubes


<p><a href="http://paulbourke.net/geometry/polygonise/">Polygonising a scalar field (Marching Cubes)</a></p>

Voxelの頂点のパターンからそのVoxelのポリゴンパターンをLookupしてMesh化する。  
  
シャープな形状が作りにくいらしい。



</div>
<div class="section">
    

### Dual Contour


<p><a href="https://people.eecs.berkeley.edu/~jrs/meshpapers/SchaeferWarren2.pdf">https://people.eecs.berkeley.edu/~jrs/meshpapers/SchaeferWarren2.pdf</a></p>

あるVoxelを構成する辺について、SDFをの符号が異なる両端を持つ辺に注目し、辺を横切るような等値面の交差位置と法線をSDFの勾配等から計算する。  
  
一つのVoxelについて境界面は複数存在する可能性があり、すべての境界面からの距離の自乗和が最小になるような一点をそのVoxel内の頂点として最小二乗法で推定する。  
  
すべてのVoxelについて上記の点を計算し、隣接Cellで点同士をつなげてMeshを構成する。  
  
シャープな形状を作ることができるらしい。  
  
Voxel毎に最小二乗法を解く必要があるためコストが高い可能性。  
  
また自己交差メッシュができてしまう可能性もある。



</div>
<div class="section">
    

### SurfaceNets


<p><a href="https://www.merl.com/publications/docs/TR99-24.pdf">https://www.merl.com/publications/docs/TR99-24.pdf</a><br />
<a href="https://medium.com/@bonsairobo/smooth-voxel-mapping-a-technical-deep-dive-on-real-time-surface-nets-and-texturing-ef06d0f8ca14">Smooth Voxel Mapping: a Technical Deep Dive on Real-time Surface Nets and Texturing | by DreamCat Games | Aug, 2020 | Medium</a><br />
<a href="https://github.com/TomaszFoster/NaiveSurfaceNets/blob/master/NaiveSurfaceNets.cs">NaiveSurfaceNets/NaiveSurfaceNets.cs at master &middot; TomaszFoster/NaiveSurfaceNets &middot; GitHub</a></p><br />


Meshを構成するVoxel内の頂点を推定することはDual Contourと同様だが、複数ある辺と等値面の交差位置を平均した地点を頂点位置とするところが異なる。



</div>

---

[元のはてなブログ記事](https://nagakagachi.hatenablog.com/entry/2020/08/22/180515)
