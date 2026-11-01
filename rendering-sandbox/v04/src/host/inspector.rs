use crate::scene::Camera;

// 操作パネルは共通設定を編集するだけで、GPUコマンドを発行しない。
impl super::State {
    pub(super) fn inspector(&mut self, ui: &mut egui::Ui) {
        let before = self.modeler;
        ui.horizontal(|ui| {
            ui.selectable_value(&mut self.modeler, false, "Renderer");
            ui.selectable_value(&mut self.modeler, true, "Foliage Modeler");
        });
        if before != self.modeler {
            self.camera = if self.modeler {
                Camera {
                    position: glam::Vec3::new(0., 6., 18.),
                    speed: 10.,
                    ..Default::default()
                }
            } else {
                Camera::default()
            };
            self.settings.freeze = false;
            self.settings.leaf_lod = if self.modeler { 0 } else { -1 };
        }
        if self.modeler {
            ui.horizontal(|ui| {
                for (name, yaw, pitch) in
                    [("正面", 0., 0.), ("斜め", 0.65, 0.5), ("上面", 0., 1.50)]
                {
                    if ui.button(name).clicked() {
                        self.camera.yaw = yaw;
                        self.camera.pitch = pitch;
                        let target = glam::Vec3::new(
                            0.,
                            if self.renderer.cluster_mode == 0 {
                                self.model.height * 0.5
                            } else {
                                0.8
                            },
                            0.,
                        );
                        let radius =
                            if self.renderer.preview_count > 1 && self.renderer.cluster_mode == 0 {
                                (self.renderer.preview_count as f32).sqrt().ceil() * 18.
                            } else {
                                18.
                            };
                        self.camera.position = target - self.camera.forward() * radius;
                    }
                }
            });
            ui.checkbox(&mut self.settings.modeler_silhouette, "シルエット表示");
            ui.collapsing("樹木モデリング", |ui| {
                egui::ComboBox::from_label("プレビュー")
                    .selected_text(
                        ["樹木", "枝葉部品", "枝葉LOD比較"][self.renderer.cluster_mode as usize],
                    )
                    .show_ui(ui, |ui| {
                        for (i, n) in ["樹木", "枝葉部品", "枝葉LOD比較"].iter().enumerate()
                        {
                            ui.selectable_value(&mut self.renderer.cluster_mode, i as u32, *n);
                        }
                    });
                ui.checkbox(&mut self.renderer.skeleton, "骨格中心線");
                if self.renderer.cluster_mode == 2 {
                    ui.label("左からLOD0 / LOD1 / LOD2 / LOD3");
                }

                let old = self.model.form;
                egui::ComboBox::from_label("樹形")
                    .selected_text(["円錐", "卵", "球", "傘", "杯", "しだれ"][self.model.form])
                    .show_ui(ui, |ui| {
                        for (i, n) in ["円錐", "卵", "球", "傘", "杯", "しだれ"]
                            .iter()
                            .enumerate()
                        {
                            ui.selectable_value(&mut self.model.form, i, *n);
                        }
                    });
                if old != self.model.form {
                    self.model.shape = crate::models::preset(self.model.form);
                }
                ui.add(egui::DragValue::new(&mut self.model.seed).prefix("シード "));
                ui.add(egui::Slider::new(&mut self.model.height, 3.0..=20.0).text("樹高"));
                ui.add(egui::Slider::new(&mut self.model.crown, 2.0..=10.0).text("樹冠幅"));
                ui.add(egui::Slider::new(&mut self.model.bend, 0.0..=3.0).text("主幹の曲がり"));
                ui.add(egui::Slider::new(&mut self.model.branches, 0..=3).text("主要枝数"));
                ui.add(egui::Slider::new(&mut self.model.sockets, 4..=48).text("取り付け数"));
                ui.add(
                    egui::Slider::new(&mut self.renderer.preview_count, 1..=100).text("配置本数"),
                );
                ui.add(egui::Slider::new(&mut self.renderer.wood_lod, 0..=2).text("幹LOD"));
                egui::ComboBox::from_label("枝葉規模クラス")
                    .selected_text(["小", "中", "大"][self.model.class])
                    .show_ui(ui, |ui| {
                        for (i, n) in ["小", "中", "大"].iter().enumerate() {
                            ui.selectable_value(&mut self.model.class, i, *n);
                        }
                    });
                egui::ComboBox::from_label("バリエーション")
                    .selected_text(["扇状", "丸い塊", "垂れ枝", "松風"][self.model.variation])
                    .show_ui(ui, |ui| {
                        for (i, n) in ["扇状", "丸い塊", "垂れ枝", "松風"].iter().enumerate()
                        {
                            ui.selectable_value(&mut self.model.variation, i, *n);
                        }
                    });
                ui.add(egui::Slider::new(&mut self.model.spread, 0.4..=1.8).text("枝の広がり"));
                ui.add(egui::Slider::new(&mut self.model.opening, 0.4..=1.6).text("葉の開き"));
                ui.add(egui::Slider::new(&mut self.model.depth, 0.4..=1.8).text("奥行き"));
                ui.add(egui::Slider::new(&mut self.model.leaf_size, 0.4..=1.6).text("葉のサイズ"));
                ui.add(egui::Slider::new(&mut self.model.radius, 0.01..=0.08).text("幹の太さ"));
                ui.add(egui::Slider::new(&mut self.model.taper, 0.5..=2.0).text("幹のテーパー"));
                ui.collapsing("樹形パラメータ", |ui| {
                    for i in 0..20 {
                        let (a, b) = crate::models::SHAPE_RANGES[i];
                        ui.add(
                            egui::Slider::new(&mut self.model.shape[i], a..=b)
                                .text(crate::models::SHAPE_NAMES[i]),
                        );
                    }
                    self.model.shape[2] = self.model.shape[2].max(self.model.shape[1]);
                    self.model.shape[15] = self.model.shape[15].max(self.model.shape[14]);
                });
            });
        }
        ui.heading("RenderingSandbox v04");
        ui.label("Rust / wgpu / egui");
        ui.separator();
        ui.horizontal(|ui| {
            ui.checkbox(&mut self.measure, "GPU計測");
            ui.checkbox(&mut self.continuous, "連続描画");
        });
        if !self.profiler.supported() {
            ui.label("GPU Frame：計測非対応");
        } else if let Some(ms) = self.profiler.milliseconds {
            ui.label(format!("GPU Frame：{ms:.3} ms"));
            ui.small(format!(
                "計測フレーム #{}・平滑値／停止中は最終値",
                self.profiler.frame
            ));
        } else {
            ui.label("GPU Frame：取得中");
        }
        ui.collapsing("GPUパス時間", |ui| {
            for (name, ms) in &self.profiler.passes {
                ui.label(format!("{name}：{ms:.3} ms"));
            }
            ui.small("パス値は最新サンプル。Frameは区間経過時間で、和とは異なります");
        });
        ui.collapsing("描画", |ui| {
            egui::ComboBox::from_label("描画解像度")
                .selected_text(self.resolution.label())
                .show_ui(ui, |ui| {
                    for mode in super::resolution::Resolution::ALL {
                        ui.selectable_value(&mut self.resolution, mode, mode.label());
                    }
                });
            ui.label(format!(
                "現在 {}×{}",
                self.renderer.size[0], self.renderer.size[1]
            ));
            ui.checkbox(&mut self.settings.culling, "フラスタムカリング");
            ui.checkbox(
                &mut self.settings.caster_volume,
                "ShadowCasterVolumeCulling",
            );
            ui.checkbox(&mut self.settings.freeze, "カリング・配置を固定");
            ui.checkbox(&mut self.settings.wire, "ワイヤーフレーム");
        });
        ui.collapsing("カメラ", |ui| {
            if ui.button("カメラを戻す").clicked() {
                self.camera = Camera::default();
            }
            ui.add(egui::Slider::new(&mut self.settings.ev, -10.0..=15.0).text("露出 EV100"));
            ui.add(egui::Slider::new(&mut self.settings.fov, 30.0..=110.0).text("画角"));
            ui.add(
                egui::Slider::new(&mut self.camera.speed, 1.0..=1000.0)
                    .logarithmic(true)
                    .text("移動速度"),
            );
            ui.label(format!(
                "XYZ {:.1} / {:.1} / {:.1}",
                self.camera.position.x, self.camera.position.y, self.camera.position.z
            ));
        });
        ui.collapsing("地形", |ui| {
            ui.add(egui::DragValue::new(&mut self.settings.seed).prefix("シード "));
            ui.add(egui::Slider::new(&mut self.settings.amplitude, 0.0..=4000.0).text("標高振幅"));
            ui.add(
                egui::Slider::new(&mut self.settings.mountain_scale, 100.0..=10000.0)
                    .text("山スケール"),
            );
            egui::ComboBox::from_label("タイル密度")
                .selected_text(self.settings.density.to_string())
                .show_ui(ui, |ui| {
                    for n in [4, 8, 16] {
                        ui.selectable_value(&mut self.settings.density, n, n.to_string());
                    }
                });
            ui.add(
                egui::Slider::new(&mut self.settings.radius, 128.0..=16000.0)
                    .logarithmic(true)
                    .text("カバー半径"),
            );
            ui.checkbox(&mut self.settings.snap, "グリッドスナップ");
            ui.checkbox(&mut self.settings.constant_albedo, "固定アルベド");
            for (i, name) in ["R", "G", "B"].iter().enumerate() {
                ui.add(egui::Slider::new(&mut self.settings.albedo[i], 0.0..=1.0).text(*name));
            }
            ui.add(egui::Slider::new(&mut self.settings.roughness, 0.04..=1.0).text("ラフネス"));
            ui.add(egui::Slider::new(&mut self.settings.metallic, 0.0..=1.0).text("メタリック"));
        });
        ui.collapsing("ライト・シャドウ", |ui| {
            ui.checkbox(&mut self.settings.direct, "直接光");
            ui.add(egui::Slider::new(&mut self.settings.azimuth, 0.0..=360.0).text("方位角"));
            ui.add(egui::Slider::new(&mut self.settings.elevation, 1.0..=89.0).text("仰角"));
            ui.checkbox(&mut self.settings.shadows, "シャドウ");
            ui.add(
                egui::Slider::new(&mut self.settings.shadow_distance, 128.0..=16000.0)
                    .logarithmic(true)
                    .text("CSM距離"),
            );
            ui.add(
                egui::Slider::new(&mut self.settings.depth_bias, 0.0..=1.0).text("深度バイアス m"),
            );
            ui.add(
                egui::Slider::new(&mut self.settings.normal_bias, 0.0..=2.0).text("法線バイアス m"),
            );
            ui.add(egui::Slider::new(&mut self.settings.pcf, 0..=2).text("PCF半径"));
        });
        ui.collapsing("Sky", |ui| {
            ui.add(egui::Slider::new(&mut self.settings.sky, 0.0..=4.0).text("SkyLight"));
            ui.checkbox(&mut self.settings.specular, "Specular IBL");
            ui.checkbox(&mut self.settings.aerial, "大気遠近法");
            ui.checkbox(&mut self.settings.animate, "太陽を動かす");
        });
        ui.collapsing("樹木", |ui| {
            ui.checkbox(&mut self.settings.trees, "樹木を表示");
            ui.add(egui::Slider::new(&mut self.settings.tree_density, 0.0..=1.0).text("密度"));
            ui.add(egui::Slider::new(&mut self.settings.tree_budget, 1..=8).text("生成チャンク数"));
            egui::ComboBox::from_label("枝葉LOD")
                .selected_text(if self.settings.leaf_lod < 0 {
                    "自動".into()
                } else {
                    format!("LOD{}固定", self.settings.leaf_lod)
                })
                .show_ui(ui, |ui| {
                    ui.selectable_value(&mut self.settings.leaf_lod, -1, "自動");
                    for lod in 0..4 {
                        ui.selectable_value(
                            &mut self.settings.leaf_lod,
                            lod,
                            format!("LOD{lod}固定"),
                        );
                    }
                });
            egui::ComboBox::from_label("樹木デバッグ")
                .selected_text(
                    ["通常表示", "幹LOD", "チャンク", "Draw", "枝葉LOD"]
                        [self.settings.tree_debug as usize],
                )
                .show_ui(ui, |ui| {
                    for (i, n) in ["通常表示", "幹LOD", "チャンク", "Draw", "枝葉LOD"]
                        .iter()
                        .enumerate()
                    {
                        ui.selectable_value(&mut self.settings.tree_debug, i as u32, *n);
                    }
                });
            ui.label(&self.renderer.foliage.stats);
        });
        ui.collapsing("デバッグ", |ui| {
            egui::ComboBox::from_label("メインビュー")
                .selected_text(
                    ["通常表示", "RawDepth", "LinearDepth"][self.settings.debug as usize],
                )
                .show_ui(ui, |ui| {
                    for (i, n) in ["通常表示", "RawDepth", "LinearDepth"].iter().enumerate() {
                        ui.selectable_value(&mut self.settings.debug, i as u32, *n);
                    }
                });
            ui.add(
                egui::Slider::new(&mut self.settings.linear_distance, 1.0..=16000.0)
                    .logarithmic(true)
                    .text("正規化距離 m"),
            );
            ui.checkbox(&mut self.settings.normals, "法線");
            ui.checkbox(&mut self.settings.tile_colors, "タイル色分け");
            ui.checkbox(&mut self.settings.height_colors, "Height Clipmap色分け");
            ui.checkbox(&mut self.settings.height_grid, "HeightMap 16テクセル格子");
            ui.checkbox(&mut self.settings.shadow_debug, "Shadow Atlas RawDepth");
            ui.checkbox(&mut self.settings.csm_colors, "CSM色分け");
            ui.checkbox(&mut self.settings.csm_grid, "CSMテクセル格子");
            ui.add(
                egui::Slider::new(&mut self.settings.grid_texels, 1.0..=64.0).text("CSM格子間隔"),
            );
            ui.checkbox(&mut self.settings.shadow_mask, "Shadow可視率");
            ui.checkbox(&mut self.settings.sky_debug, "Sky Octahedral");
            ui.checkbox(&mut self.settings.specular_debug, "GGX Octahedral");
            ui.add(egui::Slider::new(&mut self.renderer.specular_mip, 0..=4).text("GGX Mip"));
        });
        ui.collapsing("構成情報", |ui| {
            ui.label(&self.adapter);
            ui.label(format!(
                "描画 {}×{}",
                self.renderer.size[0], self.renderer.size[1]
            ));
            ui.label(format!("Height更新 {}サンプル", self.renderer.samples));
            ui.label("FP16 Height Clipmap・共有IB・VBなし");
            ui.label("Reversed Z / HDR / CSM 4×1024²");
        });
    }
}
