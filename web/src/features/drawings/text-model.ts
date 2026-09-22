export interface TextStyle {
  content: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  background: boolean;
  backgroundColor: string;
  backgroundOpacity: number;
  border: boolean;
  borderColor: string;
  wrapWidth: number;
}

export function createTextStyle(content = 'Text'): TextStyle {
  return { content: content.replace(/\r\n?/g, '\n'), fontSize: 14, bold: false, italic: false,
    background: false, backgroundColor: '#000000', backgroundOpacity: .6,
    border: false, borderColor: '#4f8cff', wrapWidth: 240 };
}

export function validTextStyle(value: unknown): value is TextStyle {
  if (!value || typeof value !== 'object') return false;
  const style = value as TextStyle;
  return typeof style.content === 'string' && style.content.length <= 1000 && style.content.trim().length > 0
    && !style.content.includes('\r') && style.content.split('\n').length <= 20
    && Number.isInteger(style.fontSize) && style.fontSize >= 10 && style.fontSize <= 48
    && Number.isInteger(style.wrapWidth) && style.wrapWidth >= 80 && style.wrapWidth <= 640
    && typeof style.bold === 'boolean' && typeof style.italic === 'boolean'
    && typeof style.background === 'boolean' && typeof style.border === 'boolean'
    && typeof style.backgroundColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(style.backgroundColor)
    && typeof style.borderColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(style.borderColor)
    && Number.isFinite(style.backgroundOpacity) && style.backgroundOpacity >= 0 && style.backgroundOpacity <= 1;
}
