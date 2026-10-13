//! Writes a cover's thumbnail and samples its dominant colour from one decode of the cached cover.
//!
//! The cached covers are up to 2000 px. Decoding them here, on blocking threads, keeps the
//! work off the webview and lets several covers decode at once during a sync.

use std::fs::File;
use std::io::BufWriter;
use std::path::{Component, Path, PathBuf};

use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::RgbImage;
use tauri::{AppHandle, Manager};

const ALBUM_COVERS_DIRECTORY_NAME: &str = "covers";
const ALBUM_COVER_THUMBNAIL_JPEG_QUALITY: u8 = 88;
/// Limits the image the frontend can ask for, so that a bad size cannot exhaust memory.
const MAXIMUM_THUMBNAIL_SIZE_PX: u32 = 2048;

/// Covers are scaled to this many pixels square before the colour is sampled.
const DOMINANT_COLOUR_SAMPLE_SIZE: u32 = 32;
/// Bits kept per channel when pixels are grouped into colour buckets.
const COLOUR_BUCKET_BITS_PER_CHANNEL: u32 = 4;

/// Writes `thumbnail_file_name` at `thumbnail_size_px` square from `cover_file_name`, both in the
/// covers directory, and returns the cover's dominant colour as "#rrggbb".
/// The names must be bare file names, so that the frontend cannot reach other files.
#[tauri::command]
pub async fn write_album_cover_thumbnail_and_sample_colour(
    app_handle: AppHandle,
    cover_file_name: String,
    thumbnail_file_name: String,
    thumbnail_size_px: u32,
) -> Result<String, String> {
    let covers_directory_path = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join(ALBUM_COVERS_DIRECTORY_NAME);
    if !(1..=MAXIMUM_THUMBNAIL_SIZE_PX).contains(&thumbnail_size_px) {
        return Err(format!("Thumbnail size must be 1 to {MAXIMUM_THUMBNAIL_SIZE_PX} px."));
    }
    let cover_file_path = covers_directory_path.join(require_bare_file_name(&cover_file_name)?);
    let thumbnail_file_path = covers_directory_path.join(require_bare_file_name(&thumbnail_file_name)?);

    tauri::async_runtime::spawn_blocking(move || {
        write_thumbnail_and_sample_colour(cover_file_path, thumbnail_file_path, thumbnail_size_px)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Accepts only a single plain path component ending in ".jpg". Checking the components, and not
/// only the separators, also rejects Windows drive prefixes such as "C:x.jpg", which `join`
/// would treat as a path outside the covers directory.
fn require_bare_file_name(file_name: &str) -> Result<&str, String> {
    let mut path_components = Path::new(file_name).components();
    let is_single_plain_component = matches!(path_components.next(), Some(Component::Normal(_)))
        && path_components.next().is_none()
        && !file_name.contains(['/', '\\', ':']);
    if is_single_plain_component && file_name.ends_with(".jpg") {
        Ok(file_name)
    } else {
        Err(format!("Not a bare .jpg file name: {file_name}"))
    }
}

fn write_thumbnail_and_sample_colour(
    cover_file_path: PathBuf,
    thumbnail_file_path: PathBuf,
    thumbnail_size_px: u32,
) -> Result<String, String> {
    let cover_image = image::open(&cover_file_path)
        .map_err(|error| format!("Could not decode {}: {error}", cover_file_path.display()))?
        .to_rgb8();

    let thumbnail_image =
        image::imageops::resize(&cover_image, thumbnail_size_px, thumbnail_size_px, FilterType::CatmullRom);
    let thumbnail_file = File::create(&thumbnail_file_path).map_err(|error| error.to_string())?;
    JpegEncoder::new_with_quality(BufWriter::new(thumbnail_file), ALBUM_COVER_THUMBNAIL_JPEG_QUALITY)
        .encode_image(&thumbnail_image)
        .map_err(|error| error.to_string())?;

    let colour_sample_image = image::imageops::resize(
        &thumbnail_image,
        DOMINANT_COLOUR_SAMPLE_SIZE,
        DOMINANT_COLOUR_SAMPLE_SIZE,
        FilterType::Triangle,
    );
    Ok(compute_dominant_colour(&colour_sample_image))
}

#[derive(Clone, Copy, Default)]
struct ColourBucket {
    weight: f64,
    red_sum: f64,
    green_sum: f64,
    blue_sum: f64,
}

/// Returns the image's dominant colour as "#rrggbb".
///
/// Pixels are grouped into colour buckets. Each pixel counts more the more saturated it is,
/// so that a vivid colour wins over a larger area of grey; the result is the mean colour of
/// the heaviest bucket. An empty image gives mid grey.
fn compute_dominant_colour(sample_image: &RgbImage) -> String {
    let bucket_shift = 8 - COLOUR_BUCKET_BITS_PER_CHANNEL;
    let mut colour_buckets = vec![ColourBucket::default(); 1 << (3 * COLOUR_BUCKET_BITS_PER_CHANNEL)];

    for pixel in sample_image.pixels() {
        let [red, green, blue] = pixel.0;
        let channel_maximum = red.max(green).max(blue) as f64;
        let channel_minimum = red.min(green).min(blue) as f64;
        let saturation = if channel_maximum == 0.0 {
            0.0
        } else {
            (channel_maximum - channel_minimum) / channel_maximum
        };
        let pixel_weight = 1.0 + saturation * 3.0;

        let bucket_key = ((red as usize >> bucket_shift) << (2 * COLOUR_BUCKET_BITS_PER_CHANNEL))
            | ((green as usize >> bucket_shift) << COLOUR_BUCKET_BITS_PER_CHANNEL)
            | (blue as usize >> bucket_shift);
        let colour_bucket = &mut colour_buckets[bucket_key];
        colour_bucket.weight += pixel_weight;
        colour_bucket.red_sum += red as f64 * pixel_weight;
        colour_bucket.green_sum += green as f64 * pixel_weight;
        colour_bucket.blue_sum += blue as f64 * pixel_weight;
    }

    let mut heaviest_bucket = ColourBucket { weight: 1.0, red_sum: 128.0, green_sum: 128.0, blue_sum: 128.0 };
    for colour_bucket in colour_buckets {
        if colour_bucket.weight > heaviest_bucket.weight {
            heaviest_bucket = colour_bucket;
        }
    }
    let to_channel = |channel_sum: f64| (channel_sum / heaviest_bucket.weight).round() as u8;
    format!(
        "#{:02x}{:02x}{:02x}",
        to_channel(heaviest_bucket.red_sum),
        to_channel(heaviest_bucket.green_sum),
        to_channel(heaviest_bucket.blue_sum)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgb;

    #[test]
    fn dominant_colour_prefers_a_vivid_colour_over_a_slightly_larger_area_of_grey() {
        let sample_image = RgbImage::from_fn(22, 1, |x, _| if x < 12 { Rgb([120, 120, 120]) } else { Rgb([220, 30, 40]) });
        assert_eq!(compute_dominant_colour(&sample_image), "#dc1e28");
    }

    #[test]
    fn dominant_colour_of_an_empty_image_is_mid_grey() {
        assert_eq!(compute_dominant_colour(&RgbImage::new(0, 0)), "#808080");
    }

    #[test]
    fn only_bare_file_names_are_accepted() {
        assert!(require_bare_file_name("ab67616d000082c1abc_large.jpg").is_ok());
        for rejected_file_name in
            ["", ".", "..", "../albums.json", "/etc/passwd", "covers\\x.jpg", "C:evil.jpg", "..jpg/x.jpg", "albums.json"]
        {
            assert!(require_bare_file_name(rejected_file_name).is_err(), "{rejected_file_name}");
        }
    }

    #[test]
    fn writes_a_thumbnail_of_the_requested_size() {
        let test_directory = std::env::temp_dir().join(format!("shelf_thumbnail_test_{}", std::process::id()));
        std::fs::create_dir_all(&test_directory).unwrap();
        let cover_file_path = test_directory.join("cover.jpg");
        let thumbnail_file_path = test_directory.join("thumbnail.jpg");
        RgbImage::from_pixel(600, 600, Rgb([30, 90, 200])).save(&cover_file_path).unwrap();

        let dominant_colour = write_thumbnail_and_sample_colour(cover_file_path, thumbnail_file_path.clone(), 256).unwrap();

        assert_eq!(image::image_dimensions(&thumbnail_file_path).unwrap(), (256, 256));
        assert!(dominant_colour.starts_with('#') && dominant_colour.len() == 7);
        std::fs::remove_dir_all(&test_directory).unwrap();
    }
}
