import JSZip, { JSZipObject } from "jszip";

(async () => {
    const currentUrl = window.location.href;
    const baseUrl = new URL(currentUrl).origin;

    const metaData = await fetchContent(baseUrl);

    const eDataRegex = /eData=\[("[^"]*"(?:,\s*"[^"]*")*)\]/;
    const eDataMatches = metaData.match(eDataRegex)

    if (!eDataMatches) {
        console.log('eData not found.');
        return
    }

    const eData = JSON.parse(`[${eDataMatches[1]}]`);

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
    const spine = json.b.spine as any[];
    const cmptParams = json.b["-odread-cmpt-params"];

    const zip = new JSZip()

    const mainContainer = document.createElement('div');
    document.body.appendChild(mainContainer);

    // Get main content as [title, content] (needs to be inserted as iframes into main container and load)
    const mainContent = await Promise.all(spine.map((entry, index) =>
        loadIFrameContent(mainContainer, baseUrl, entry.path, cmptParams[index])
    ))

    const domParser = new DOMParser()

    const imagePaths = new Set<string>()
    const styleSheetPaths = new Set<string>()

    mainContent.forEach(([, content]) => {
        const contentDoc = domParser.parseFromString(content, 'text/html')

        // Add all image paths to set
        contentDoc.querySelectorAll('img').forEach(img => {
            const src = img.getAttribute('src')
            if (src !== null) {
                imagePaths.add(src)
            }
        })

        // Add all style sheet paths to set
        contentDoc.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
            const href = link.getAttribute('href')
            if (href !== null) {
                styleSheetPaths.add(href)
            }
        })
    })



    // Get all CSS resource paths (such as fonts)
    const resourcePaths = new Set(
        mainContent.flatMap(([, content]) => {
            const doc = domParser.parseFromString(content, 'text/html')

            const imagePaths = Array.from(doc.querySelectorAll('img'))
                .map(img => img.getAttribute('src'))
                .filter((src): src is string => src !== null)

            const styleSheetPaths = Array.from(doc.querySelectorAll('link[rel="stylesheet"]'))
                .map(link => link.getAttribute('href'))
                .filter((href): href is string => href !== null)

            return [...imagePaths, ...styleSheetPaths]
        })
    )

    await fetchToZip(zip, resourcePaths, 'OEBPS')

    let cssFiles: JSZipObject[] = []
    zip.forEach((relativePath, file) => {
        if (!relativePath.endsWith('.css')) {
            return
        }
        cssFiles.push(file)
    })

    const cssUrlRegex = /url\(\s*['"]?([^'")]+)['"]?\s*\)/g
    const cssResourcePaths = new Set<string>()

    for (const cssFile of cssFiles) {
        const cssContent = await cssFile.async('string')
        let match;
        while ((match = cssUrlRegex.exec(cssContent)) !== null) {
            // TODO: Find smarter way to dynamically correct url - rather than just removing "../"
            const path = match[1].replace(/^(\.\.\/)/, '')
            cssResourcePaths.add(path)
        }
    }

    console.log(cssResourcePaths)

    await fetchToZip(zip, cssResourcePaths, 'OEBPS')

    mainContent.forEach(([title, content]) => {
        zip.folder('OEBPS')?.file(title, content)
    })


    // Get toc files
    const tocNcxTitle = "toc.ncx"
    const tocXhtmlTitle = "toc.xhtml"
    zip.folder('OEBPS')?.file(tocNcxTitle, await fetchContent(`${baseUrl}/${tocNcxTitle}`))
    zip.folder('OEBPS')?.file(tocXhtmlTitle, await fetchContent(`${baseUrl}/${tocXhtmlTitle}`))

    const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' });
    // Format data
    const url = URL.createObjectURL(blob);
    const fileName = `${json.b.title.main}.epub`

    // Download by utilizing a temporary hyperlink tag
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click(); // Trigger the download
    // const iframesContent = await Promise.all(iframeUrls.map(url => loadIFrameContent(mainContainer, url)))
    // console.log(iframeUrls)
    // console.log(iframesContent)

    // const domParser = new DOMParser() 
    // const parsedContent = mainContent.map(([_, content]) => domParser.parseFromString(content, 'text/html'))

    /*
    for (let index = 0; index < parsedContent.length; index++) {
        const element = parsedContent[index];
        element.querySelectorAll('img').forEach(img => {
            const src = img.getAttribute('src')
            if (src == null) { return }
            paths.add(src)
        })
    }

    console.log(paths)
    */
    // console.log(CSSUrl)
    // console.log(textContent)

    // const response_2 = await fetch(currentUrl);
})();

async function fetchContent(url: string) {
    const response = await fetch(url);
    return await response.text();
}

async function fetchToZip(zip: JSZip, resourcePaths: Set<string>, baseDirectory: string = "") {
    console.log(resourcePaths)
    for (const path of resourcePaths) {
        const response = await fetch(path);
        const blob = await response.blob();
        console.log(path)
        zip.file(`${baseDirectory}/${path}`, blob);
    }
}

function loadIFrameContent(div: HTMLDivElement, baseUrl: string, path: string, params: string) {
    return new Promise<[string, string]>((resolve, reject) => {
        const iframe = document.createElement('iframe');
        iframe.src = `${baseUrl}/${path}?${params}`;
        iframe.onload = () => {
            let content = iframe.contentDocument?.documentElement.innerHTML;
            if (!content) {
                reject(new Error(`Failed to read content of iframe with path: ${path}`));
                return;
            }

            resolve([path, content]);
        }
        iframe.onerror = () => reject(new Error(`Failed to load iframe with path: ${path}`));
        div.appendChild(iframe)
    })
}

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