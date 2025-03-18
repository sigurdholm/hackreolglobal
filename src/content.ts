
(async () => {
    const currentUrl = window.location.href;
    const baseUrl = new URL(currentUrl).origin;

    const response = await fetch(baseUrl);
    const text = await response.text();

    const eDataRegex = /eData=\[("[^"]*"(?:,\s*"[^"]*")*)\]/;
    const matches = text.match(eDataRegex)

    if (!matches) {
        console.log('eData not found.');
        return
    }

    const eData = JSON.parse(`[${matches[1]}]`);

    const key = currentUrl
        .split(".")[0]
        .split("-")[1]
        .split("")
        .reverse()
        .join("");

    const keyShiftedData = shiftTextByKey(eData.join('"'), key);

    const decoder = new Base64Decoder(keyShiftedData);
    const decodedData = decoder.decode();
    const json = JSON.parse(decodedData);
    console.log(json)
    const spine = json.b.spine;
    const cmptParams = json.b["-odread-cmpt-params"];

    let blobs: Blob[] = []

    const div = document.createElement('div');
    document.body.appendChild(div);

    for (let index = 0; index < spine.length; index++) {
        const path = spine[index].path;
        const url_2 = `${baseUrl}/${path}?${cmptParams[index]}`;
        const iframe = document.createElement('iframe');
        iframe.src = url_2;
        iframe.onload = () => {
            // Access the iframe's document
            let content = iframe.contentDocument?.documentElement.innerHTML;
            if (!content) {
                console.log(`Failed to read ${path}`);
                return;
            }
            console.log(content)
            // blobs.push(new Blob([content], { '' }))
            
        }
        div.appendChild(iframe)

    }

    // const response_2 = await fetch(currentUrl);
})();

function shiftTextByKey(text: string, key: string) {
    const ASCII_RANGE = { min: 32, max: 126 }
    let result = [];

    for (let index = 0; index < text.length; index++) {
        let charCode = text.charCodeAt(index);
        let keyChar = key[index % key.length]
        let keyNumber = parseFloat(keyChar);

        if (keyNumber) {
            charCode += (index + keyNumber) % (ASCII_RANGE.max - ASCII_RANGE.min)

            if (charCode > ASCII_RANGE.max) {
                charCode = charCode % ASCII_RANGE.max + ASCII_RANGE.min;
            }
        }

        result.push(String.fromCharCode(charCode));
    }

    return result.join("")
}

class Base64Decoder {
    readonly charSet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";

    private input: string;
    private index: number;
    private current: number;
    private buffer: Array<number>;

    constructor(input: string) {
        this.input = input;
        this.index = -1;
        this.current = 64;
        this.buffer = [];
    }

    decode(): string {
        this.reset();

        let result = [];

        while (this.moveNext()) {
            let byte1 = this.current;

            if (byte1 < 128) {
                // Single-byte character (ASCII)
                result.push(String.fromCharCode(byte1));
            } else if (byte1 > 191 && byte1 < 224) {
                // Two-byte UTF-8 character (110xxxxx 10xxxxxx)
                this.moveNext();
                let byte2 = this.current;
                let charCode = ((byte1 & 31) << 6) | (byte2 & 63);

                result.push(String.fromCharCode(charCode));
            } else {
                // Three-byte UTF-8 character (1110xxxx 10xxxxxx 10xxxxxx)
                this.moveNext();
                let byte2 = this.current;
                this.moveNext();
                let byte3 = this.current;
                let charCode = ((byte1 & 15) << 12) | ((byte2 & 63) << 6) | (byte3 & 63);

                result.push(String.fromCharCode(charCode));
            }
        }

        return result.join("");
    }

    private reset() {
        this.index = -1;
        this.current = 64;
        this.buffer = [];
    }

    private moveNext(): boolean {
        // If the buffer has remaining decoded bytes, consume one
        let numberFromBuffer = this.buffer.shift();
        if (numberFromBuffer) {
            this.current = numberFromBuffer;
            return true;
        }

        // Stop if we've reached the end of the input
        if (this.index >= this.input.length - 1) {
            this.current = 64;
            return false;
        }

        // Read the next four Base64 characters
        var c1 = this.charSet.indexOf(this.input.charAt(++this.index));
        var c2 = this.charSet.indexOf(this.input.charAt(++this.index));
        var c3 = this.charSet.indexOf(this.input.charAt(++this.index));
        var c4 = this.charSet.indexOf(this.input.charAt(++this.index));

        // Convert to three bytes
        var byte1 = c1 << 2 | c2 >> 4
        var byte2 = (15 & c2) << 4 | c3 >> 2
        var byte3 = (3 & c3) << 6 | c4;

        // Store the first byte and queue the remaining valid ones
        this.current = byte1;
        if (c3 != 64) this.buffer.push(byte2);
        if (c4 != 64) this.buffer.push(byte3);

        return true;
    }
}