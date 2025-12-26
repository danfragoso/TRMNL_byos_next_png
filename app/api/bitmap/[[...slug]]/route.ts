import type { NextRequest } from "next/server";
import { cache } from "react";
import NotFoundScreen from "@/app/recipes/screens/not-found/not-found";
import screens from "@/app/recipes/screens.json";
import {
	addDimensionsToProps,
	buildRecipeElement,
	DEFAULT_IMAGE_HEIGHT,
	DEFAULT_IMAGE_WIDTH,
	logger,
	renderRecipeOutputs,
} from "@/lib/recipes/recipe-renderer";

export async function GET(
	req: NextRequest,
	{ params }: { params: Promise<{ slug?: string[] }> },
) {
	try {
		// Always await params as required by Next.js 14/15
		const { slug = ["not-found"] } = await params;
		const bitmapPath = Array.isArray(slug) ? slug.join("/") : slug;

		// Detect format from file extension
		const isPng = bitmapPath.endsWith(".png");
		const format: "png" | "bitmap" = isPng ? "png" : "bitmap";
		const contentType = isPng ? "image/png" : "image/bmp";

		const recipeSlug = bitmapPath.replace(/\.(bmp|png)$/, "");

		// Get width, height, grayscale, and rotate from query parameters
		const { searchParams } = new URL(req.url);
		const widthParam = searchParams.get("width");
		const heightParam = searchParams.get("height");
		const grayscaleParam = searchParams.get("grayscale");
		const rotateParam = searchParams.get("rotate");

		const width = widthParam ? parseInt(widthParam, 10) : DEFAULT_IMAGE_WIDTH;
		const height = heightParam
			? parseInt(heightParam, 10)
			: DEFAULT_IMAGE_HEIGHT;

		// Validate width and height are positive numbers
		const validWidth = width > 0 ? width : DEFAULT_IMAGE_WIDTH;
		const validHeight = height > 0 ? height : DEFAULT_IMAGE_HEIGHT;
		const grayscaleLevels = grayscaleParam ? parseInt(grayscaleParam, 10) : 2;

		// Auto-detect rotation: if width > height (landscape), rotate 90°
		// This handles cases where display sends landscape dimensions (800x600)
		// for a portrait screen (600x800)
		const autoRotate = validWidth > validHeight ? 90 : 0;
		const rotateAngle = rotateParam ? parseInt(rotateParam, 10) : autoRotate;

		logger.info(
			`${format.toUpperCase()} request for: ${bitmapPath} in ${validWidth}x${validHeight} with ${grayscaleLevels} gray levels${rotateAngle ? `, rotate ${rotateAngle}°` : ""}`,
		);

		const recipeId = screens[recipeSlug as keyof typeof screens]
			? recipeSlug
			: "simple-text";

		const recipeBuffer = await renderRecipeImage(
			recipeId,
			validWidth,
			validHeight,
			grayscaleLevels,
			format,
			rotateAngle,
		);

		if (
			!recipeBuffer ||
			!(recipeBuffer instanceof Buffer) ||
			recipeBuffer.length === 0
		) {
			logger.warn(
				`Failed to generate ${format} for ${recipeId}, returning fallback`,
			);
			const fallback = await renderFallbackImage(format, contentType);
			return fallback;
		}

		return new Response(new Uint8Array(recipeBuffer), {
			headers: {
				"Content-Type": contentType,
				"Content-Length": recipeBuffer.length.toString(),
			},
		});
	} catch (error) {
		logger.error("Error generating image:", error);

		// Instead of returning an error, return the NotFoundScreen as a fallback
		return await renderFallbackImage("bitmap", "image/bmp", "Error occurred");
	}
}

const renderRecipeImage = cache(
	async (
		recipeId: string,
		width: number,
		height: number,
		grayscaleLevels: number = 2,
		format: "png" | "bitmap" = "bitmap",
		rotate: number = 0,
	) => {
		const { config, Component, props, element } = await buildRecipeElement({
			slug: recipeId,
		});

		const ComponentToRender =
			Component ??
			(() => {
				return element;
			});

		const propsWithDimensions = addDimensionsToProps(props, width, height);

		const renders = await renderRecipeOutputs({
			slug: recipeId,
			Component: ComponentToRender,
			props: propsWithDimensions,
			config: config ?? null,
			imageWidth: width,
			imageHeight: height,
			formats: [format],
			grayscale: grayscaleLevels,
			rotate,
		});

		return (format === "png" ? renders.png : renders.bitmap) ?? Buffer.from([]);
	},
);

const renderFallbackImage = cache(async (format: "png" | "bitmap" = "bitmap", contentType: string = "image/bmp", slug: string = "not-found") => {
	try {
		const renders = await renderRecipeOutputs({
			slug,
			Component: NotFoundScreen,
			props: { slug },
			config: null,
			imageWidth: DEFAULT_IMAGE_WIDTH,
			imageHeight: DEFAULT_IMAGE_HEIGHT,
			formats: [format],
			grayscale: 2, // Default to 2 levels for fallback
		});

		const buffer = format === "png" ? renders.png : renders.bitmap;
		if (!buffer) {
			throw new Error(`Missing ${format} buffer for fallback`);
		}

		return new Response(new Uint8Array(buffer), {
			headers: {
				"Content-Type": contentType,
				"Content-Length": buffer.length.toString(),
			},
		});
	} catch (fallbackError) {
		logger.error("Error generating fallback image:", fallbackError);
		return new Response("Error generating image", {
			status: 500,
			headers: {
				"Content-Type": "text/plain",
			},
		});
	}
});
