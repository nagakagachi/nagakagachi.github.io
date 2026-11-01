#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Resolution {
    Auto,
    Hd,
    FullHd,
    Qhd,
    Uhd,
}
impl Resolution {
    pub(super) const ALL: [Self; 5] = [Self::Auto, Self::Hd, Self::FullHd, Self::Qhd, Self::Uhd];
    pub(super) fn label(self) -> &'static str {
        match self {
            Self::Auto => "Auto（上限1080p）",
            Self::Hd => "1280×720",
            Self::FullHd => "1920×1080",
            Self::Qhd => "2560×1440",
            Self::Uhd => "3840×2160",
        }
    }
    pub(super) fn pixels(self, display_width: f32, texture_limit: u32) -> [u32; 2] {
        let width = match self {
            Self::Auto => display_width.clamp(16., 1920.) as u32,
            Self::Hd => 1280,
            Self::FullHd => 1920,
            Self::Qhd => 2560,
            Self::Uhd => 3840,
        };
        // 16×9の整数倍に揃え、高DPIでもAutoの上限を超えない。
        // デバイス上限も守る。UIとSurfaceの解像度はこの制限の対象外。
        let units = (width.min(texture_limit) / 16).max(1);
        [units * 16, units * 9]
    }
}
#[cfg(test)]
mod tests {
    use super::Resolution;
    #[test]
    fn auto_caps_high_dpi_and_fixed_resolutions_keep_aspect() {
        assert_eq!(Resolution::Auto.pixels(6000., 8192), [1920, 1080]);
        assert_eq!(Resolution::Auto.pixels(1000., 8192), [992, 558]);
        assert_eq!(Resolution::Uhd.pixels(500., 8192), [3840, 2160]);
        assert_eq!(Resolution::Uhd.pixels(500., 2048), [2048, 1152]);
        for mode in Resolution::ALL {
            let [w, h] = mode.pixels(0., 8192);
            assert!(w > 0 && h > 0);
            assert_eq!(w * 9, h * 16);
        }
    }
}
