import { Global, Module } from '@nestjs/common';
import { PdfFontsService } from './pdf-fonts.service.js';

/** Loads the fonts PDFs need for Hindi and Marathi, once, when the app starts */
@Global()
@Module({ providers: [PdfFontsService] })
export class PdfFontsModule {}
