// ==UserScript==
// @name         T3 Chat PDF To Text
// @namespace    http://tampermonkey.net/
// @version      0.3
// @description  Extracts text from PDF files selected for upload in t3 chat and fills it into the chat input.
// @match        https://t3.chat/*
// @match        https://beta.t3.chat/*
// @match        https://beta.t3.chat/chat/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.min.js
// @grant        GM_log
// ==/UserScript==

(async () => {
    'use strict';

    const CONFIG = {
        workerSrc: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.worker.min.js',
        selectors: {
            fileInput: 'input[type="file"].sr-only',
            chatInput: '#chat-input'
        },
        notifier: {
            color: '#140e12',
            position: { top: '20px', right: '20px' }
        },
        concurrency: 5
    };

    const log = (...args) => GM_log(...args);

    log('PDF Extractor: Initializing...');

    const DOM = {

        waitForElement(selector, timeout = 10000) {
            return new Promise((resolve, reject) => {

                const element = document.querySelector(selector);
                if (element) return resolve(element);


                const timeoutId = setTimeout(() => {
                    observer.disconnect();
                    reject(new Error(`Timeout waiting for element: ${selector}`));
                }, timeout);


                const observer = new MutationObserver((mutations, obs) => {
                    const element = document.querySelector(selector);
                    if (element) {
                        clearTimeout(timeoutId);
                        obs.disconnect();
                        resolve(element);
                    }
                });

                observer.observe(document.documentElement, {
                    childList: true,
                    subtree: true
                });
            });
        },


        createElement(tag, styles = {}, attributes = {}, text = '') {
            const element = document.createElement(tag);


            Object.assign(element.style, styles);


            for (const [key, value] of Object.entries(attributes)) {
                element.setAttribute(key, value);
            }


            if (text) element.textContent = text;

            return element;
        }
    };


    const FileUtils = {

        readAsArrayBuffer(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = e => resolve(e.target.result);
                reader.onerror = e => reject(e);
                reader.readAsArrayBuffer(file);
            });
        },


        isPdf(file) {
            return file && (
                file.type === 'application/pdf' ||
                file.name.toLowerCase().endsWith('.pdf')
            );
        }
    };


    class ProgressNotifier {
        constructor(config = {}) {
            this.config = {
                color: CONFIG.notifier.color,
                position: CONFIG.notifier.position,
                ...config
            };
            this.elements = {
                box: null,
                content: null,
                message: null,
                track: null,
                fill: null,
                percentText: null
            };
        }


        show(message = 'Processing...') {
            this.remove();


            this.elements.box = DOM.createElement('div', {
                position: 'fixed',
                ...this.config.position,
                backgroundColor: this.config.color,
                padding: '15px',
                borderRadius: '8px',
                zIndex: '99999',
                display: 'flex',
                alignItems: 'center',
                minWidth: '280px',
                boxShadow: '0 5px 15px rgba(0,0,0,0.4)'
            });


            this.elements.content = DOM.createElement('div', {
                flex: '1'
            });
            this.elements.box.appendChild(this.elements.content);


            this.elements.message = DOM.createElement('span', {
                color: 'rgba(255,255,255,0.9)',
                fontSize: '14px',
                marginBottom: '10px',
                display: 'block'
            }, {}, message);
            this.elements.content.appendChild(this.elements.message);


            this.elements.track = DOM.createElement('div', {
                height: '10px',
                backgroundColor: 'rgba(0,0,0,0.4)',
                borderRadius: '5px',
                overflow: 'hidden',
                padding: '2px',
                boxSizing: 'border-box'
            });
            this.elements.content.appendChild(this.elements.track);


            this.elements.fill = DOM.createElement('div', {
                width: '0%',
                height: '100%',
                backgroundColor: 'rgba(255,255,255,0.6)',
                borderRadius: '3px'
            });
            this.elements.track.appendChild(this.elements.fill);


            this.elements.percentText = DOM.createElement('span', {
                color: 'rgba(255,255,255,0.7)',
                fontSize: '11px',
                textAlign: 'right',
                marginTop: '6px',
                display: 'block'
            }, {}, '0%');
            this.elements.content.appendChild(this.elements.percentText);


            document.body.appendChild(this.elements.box);
            log('Showing progress notification');
        }


        update(percent) {
            if (!this.elements.fill || !this.elements.percentText) return;

            const roundedPercent = Math.round(percent);
            this.elements.fill.style.width = `${roundedPercent}%`;
            this.elements.percentText.textContent = `${roundedPercent}%`;
        }

        updateMessage(message) {
            if (this.elements.message) {
                this.elements.message.textContent = message;
            }
        }


        remove() {
            if (this.elements.box) {
                this.elements.box.remove();
            }


            for (const key in this.elements) {
                this.elements[key] = null;
            }
        }
    }


    class PdfProcessor {
        constructor(notifierConfig = {}) {

            pdfjsLib.GlobalWorkerOptions.workerSrc = CONFIG.workerSrc;

            this.notifier = new ProgressNotifier(notifierConfig);
        }


        async process(file) {
            this.notifier.show('Extracting PDF text...');

            try {
                log(`Starting PDF processing: ${file.name}`);


                const arrayBuffer = await FileUtils.readAsArrayBuffer(file);


                const pdf = await pdfjsLib.getDocument(new Uint8Array(arrayBuffer)).promise;
                const totalPages = pdf.numPages;

                if (totalPages === 0) {
                    throw new Error('PDF file has no pages');
                }

                log(`PDF has ${totalPages} pages`);
                this.notifier.updateMessage(`Extracting PDF text (Total ${totalPages} pages)...`);


                const pagesText = new Array(totalPages);
                let processedPages = 0;


                for (let startIdx = 1; startIdx <= totalPages; startIdx += CONFIG.concurrency) {
                    const endIdx = Math.min(startIdx + CONFIG.concurrency - 1, totalPages);


                    const batchTasks = [];
                    for (let i = startIdx; i <= endIdx; i++) {
                        batchTasks.push(
                            (async (pageIndex) => {
                                const page = await pdf.getPage(pageIndex);
                                const content = await page.getTextContent();
                                const text = content.items.map(item => item.str).join(' ');


                                pagesText[pageIndex - 1] = text;


                                processedPages++;
                                this.notifier.update((processedPages / totalPages) * 100);
                            })(i)
                        );
                    }


                    await Promise.all(batchTasks);
                    log(`Completed batch ${startIdx}-${endIdx}/${totalPages}`);
                }

                const fullText = pagesText.join(' ').trim();

                log('PDF text extraction complete');
                this.notifier.remove();


                return fullText;

            } catch (error) {
                log('Error processing PDF:', error);
                this.notifier.remove();
                throw error;
            }
        }
    }


    class ChatInputHandler {
        constructor() {
            this.selector = CONFIG.selectors.chatInput;
        }


        async fillText(text) {
            try {

                const input = await DOM.waitForElement(this.selector, 5000);


                input.value = text;


                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));


                input.focus();

                if (typeof input.setSelectionRange === 'function') {
                    const len = input.value.length;
                    input.setSelectionRange(len, len);
                }


                input.scrollTop = input.scrollHeight;

                log('Text successfully filled into chat input');
                return true;

            } catch (error) {
                log('Failed to fill chat input:', error);
                alert('PDF text extracted, but could not fill chat input');
                return false;
            }
        }
    }


    class App {
        constructor() {
            this.pdfProcessor = new PdfProcessor();
            this.chatInputHandler = new ChatInputHandler();


            this.onFileSelected = this.onFileSelected.bind(this);
        }


        async processFiles(files) {
            if (files.length === 1) {
                return this.pdfProcessor.process(files[0]);
            }

            const results = await Promise.all(files.map((file, idx) => {
                const top = 20 + idx * 80;
                const processor = new PdfProcessor({ position: { top: `${top}px`, right: '20px' } });
                return processor.process(file)
                    .catch(err => { log(`Error processing ${file.name}:`, err); return ''; });
            }));

            return results.filter(t => t).join('\n\n');
        }


        async onFileSelected(event) {
            const input = event.target;

            const files = Array.from(input.files || []).filter(FileUtils.isPdf);
            if (files.length === 0) return;
            log(`Detected ${files.length} PDF file(s)`);
            try {
                const text = await this.processFiles(files);
                await this.chatInputHandler.fillText(text);
            } catch (err) {
                alert(`Error processing PDF file(s): ${err.message}`);
            } finally {

                try { input.value = ''; } catch {}
            }
        }


        async init() {
            try {

                const fileInput = await DOM.waitForElement(CONFIG.selectors.fileInput);


                fileInput.addEventListener('change', this.onFileSelected);

                log('PDF Text Extractor activated');

            } catch (error) {
                log('Initialization failed:', error);
            }
        }
    }


    const app = new App();
    await app.init();
})();
