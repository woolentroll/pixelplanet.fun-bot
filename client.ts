import * as fs from "fs";
import { PNG } from "pngjs";
import readline from "readline";
import { ChunkCache } from "./chunkCache";
import colorConverter from "./colorConverter";
import { Guid } from "./guid";
import { timeoutFor } from "./timeoutHelper";
import userInput, { IProgramParameters } from "./userInput";

const Dither = require("image-dither");

let chunks = new ChunkCache();

async function startAndGetUserInput() {
    await userInput.gatherProgramParameters();

    if (!userInput.currentParameters) {
        throw new Error("Parameters couldn't be parsed");
    }

    // tslint:disable-next-line: no-console
    console.log("-------------------------------------------\nStarting with parameters: " + JSON.stringify(userInput.currentParameters));
    return start(userInput.currentParameters);
}
async function start(params: IProgramParameters) {
    fs.createReadStream(params.imgPath)
    .pipe(new PNG())
    .on("parsed", async function(this: PNG) {

        if (params.ditherTheImage) {
            // Dither the image (makes photos look better, more realistic with color depth)
            /* matrices available to use.
            Dither.matrices.atkinson
            Dither.matrices.burkes
            Dither.matrices.floydSteinberg
            Dither.matrices.jarvisJudiceNinke
            Dither.matrices.oneDimensional
            Dither.matrices.sierraLite
            Dither.matrices.sierra2
            Dither.matrices.sierra3
            Dither.matrices.stucki
            Dither.matrices.none
            */
            const options = {
                findColor: (channelArray: [number, number, number, number]) => {
                    const convertedColor = colorConverter.convertActualColor(channelArray[0], channelArray[1], channelArray[2])
                    const resultArr = colorConverter.getActualColor(convertedColor);
                    resultArr.push(channelArray[3]);
                    return resultArr;
                },
                matrix: Dither.matrices.floydSteinberg,
            };
            const dither = new Dither(options);
            const ditheredImg = dither.dither(this.data, this.width);
            const ditheredDataBuffer = Buffer.from(ditheredImg);
            this.data = ditheredDataBuffer;
            this.pack().pipe(fs.createWriteStream("expectedOutput.png"));
        } else {
            // Convert all colors to 24 provided by the website beforehand and output a picture for a preview.
            for (let y = 0; y < this.height; y++) {
                for (let x = 0; x < this.width; x++) {
                    // tslint:disable-next-line: no-bitwise
                    const idx = (this.width * y + x) << 2;

                    const r = this.data[idx + 0];
                    const g = this.data[idx + 1];
                    const b = this.data[idx + 2];
                    const convertedColor = colorConverter.convertActualColor(r, g, b);
                    const resultArr = colorConverter.getActualColor(convertedColor);
                    this.data[idx + 0] = resultArr[0];
                    this.data[idx + 1] = resultArr[1];
                    this.data[idx + 2] = resultArr[2];
                }
            }
            this.pack().pipe(fs.createWriteStream("expectedOutput.png"));
        }
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                // For multiple machines:
                const cordId = x + y * this.width;
                if ((cordId + params.machineId + 1) % params.machineCount === 0) {
                    // This one is mine.
                } else {
                    // Not my job to paint this one
                    continue;
                }

                // tslint:disable-next-line: no-bitwise
                const idx = (this.width * y + x) << 2;

                const r = this.data[idx + 0];
                const g = this.data[idx + 1];
                const b = this.data[idx + 2];
                const a = this.data[idx + 3];
                if (a === 0) {
                    // don't draw if alpha is 0
                    continue;
                }

                const targetPixel: {x: number, y: number} = { x: (params.xLeftMost + x), y: (params.yTopMost + y) };

                const targetColor = colorConverter.convertActualColor(r, g, b);
                const currentColor = await chunks.getCoordinateColor(targetPixel.x, targetPixel.y);
                if (!colorConverter.areColorsEqual(targetColor, currentColor)) {
                    const postPixelResult = await chunks.retryPostPixel(targetPixel.x, targetPixel.y, targetColor, params.fingerprint);
                    // tslint:disable-next-line: no-console
                    console.log("Just placed " + targetColor + " at " + targetPixel.x + ":" + targetPixel.y);
                    if (postPixelResult.waitSeconds > 50) {
                        await timeoutFor((postPixelResult.waitSeconds - Math.random() * 45) * 1000);
                    }
                }
            }
        }
        if (params.constantWatch) {
            // tslint:disable-next-line: no-console
            console.log("job done. Waiting for 5 minutes, will check again.");
            setTimeout(() => {
                chunks = new ChunkCache();
                start(params);
            }, 300000);
        } else {
            // tslint:disable-next-line: no-console
            console.log("all done!");
        }
    });
}

startAndGetUserInput();
