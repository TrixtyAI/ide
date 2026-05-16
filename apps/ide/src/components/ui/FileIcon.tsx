import React from 'react';
import {
  Folder, FolderOpen, File, FileJson, FileText, Image as ImageIcon,
  FileBox, Cog, Box, Lock, Globe, Terminal, FileSpreadsheet,
  FileVideo, FileArchive, Info, Key, Hash
} from 'lucide-react';

interface FileIconProps {
  filename: string;
  isDirectory?: boolean;
  isOpen?: boolean;
  size?: number;
  className?: string;
}

const ReactIcon = ({ size = 14, className = "" }) => (
  <svg viewBox="-11.5 -10.23174 23 20.46348" width={size} height={size} className={className} fill="currentColor">
    <circle cx="0" cy="0" r="2.05" />
    <g stroke="currentColor" strokeWidth="1" fill="none">
      <ellipse rx="11" ry="4.2" />
      <ellipse rx="11" ry="4.2" transform="rotate(60)" />
      <ellipse rx="11" ry="4.2" transform="rotate(120)" />
    </g>
  </svg>
);

const LetterIcon = ({ text, color, textColor = "white", size = 14 }: { text: string; color: string; textColor?: string; size?: number }) => (
  <div
    style={{ width: size, height: size, backgroundColor: color, color: textColor }}
    className="flex items-center justify-center rounded-[3px] text-[8px] font-black tracking-tighter shrink-0"
  >
    {text}
  </div>
);

export const FileIcon: React.FC<FileIconProps> = ({
  filename,
  isDirectory = false,
  isOpen = false,
  size = 15,
  className = ""
}) => {
  const name = filename.toLowerCase();
  const ext = name.split('.').pop() || '';

  if (isDirectory) {
    const FolderIcon = isOpen ? FolderOpen : Folder;

    if (name === 'app') return <FolderIcon size={size} className={`text-red-400 ${className}`} fill="currentColor" fillOpacity={0.2} />;
    if (name === 'public') return <FolderIcon size={size} className={`text-blue-400 ${className}`} fill="currentColor" fillOpacity={0.2} />;
    if (name === 'src') return <FolderIcon size={size} className={`text-green-500 ${className}`} fill="currentColor" fillOpacity={0.2} />;
    if (name === 'components') return <FolderIcon size={size} className={`text-purple-400 ${className}`} fill="currentColor" fillOpacity={0.2} />;
    if (name === 'assets') return <FolderIcon size={size} className={`text-yellow-500 ${className}`} fill="currentColor" fillOpacity={0.2} />;
    if (name === 'node_modules') return <FolderIcon size={size} className={`text-green-600/60 ${className}`} />;
    if (name.startsWith('.')) return <FolderIcon size={size} className={`text-zinc-500 ${className}`} />;

    // Default Folder
    return <FolderIcon size={size} className={`text-[#DCB67A] ${className}`} fill="currentColor" fillOpacity={0.2} />;
  }

  // Exact file names
  if (name === 'package.json') return <FileBox size={size} className={`text-red-400 ${className}`} />;
  if (name.includes('config')) return <Cog size={size} className={`text-teal-400 ${className}`} />;
  if (name === 'favicon.ico') return <Globe size={size} className={`text-yellow-400 ${className}`} />;
  if (name.includes('.env')) return <Lock size={size} className={`text-yellow-500 ${className}`} />;
  if (name.includes('dockerfile')) return <Box size={size} className={`text-blue-500 ${className}`} />;
  if (name === 'readme.md') return <Info size={size} className={`text-sky-400 ${className}`} />;
  if (name === 'license' || name === 'license.md') return <FileText size={size} className={`text-amber-600 ${className}`} />;

  // Extensions
  switch (ext) {
    case 'tsx':
    case 'jsx':
      return <ReactIcon size={size} className={`text-[#61DAFB] ${className}`} />;
    case 'ts':
    case 'config.ts':
      return <LetterIcon text="TS" color="#3178C6" size={size} />;
    case 'js':
    case 'cjs':
    case 'mjs':
    case 'config.js':
    case 'config.cjs':
    case 'config.mjs':
      return <LetterIcon text="JS" color="#F7DF1E" textColor="#000" size={size} />;
    case 'json':
      return <FileJson size={size} className={`text-yellow-400 ${className}`} />;
    case 'css':
    case 'scss':
    case 'less':
      return <Hash size={size} className={`text-purple-400 ${className}`} />;
    case 'html':
      return <LetterIcon text="<>" color="#e34c26" size={size} />;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'svg':
    case 'ico':
      return <ImageIcon size={size} className={`text-emerald-400 ${className}`} />;
    case 'md':
    case 'mdx':
      return <FileText size={size} className={`text-sky-300 ${className}`} />;
    case 'rs':
      return <LetterIcon text="RS" color="#dea584" size={size} />;
    case 'py':
      return <LetterIcon text="PY" color="#3776ab" size={size} />;
    case 'go':
      return <LetterIcon text="GO" color="#00add8" size={size} />;
    case 'sh':
    case 'bash':
    case 'zsh':
      return <Terminal size={size} className={`text-emerald-500 ${className}`} />;
    case 'yml':
    case 'yaml':
    case 'toml':
    case 'xml':
      return <FileText size={size} className={`text-rose-400 ${className}`} />;
    case 'csv':
    case 'xls':
    case 'xlsx':
      return <FileSpreadsheet size={size} className={`text-emerald-400 ${className}`} />;
    case 'mp4':
    case 'mov':
    case 'avi':
      return <FileVideo size={size} className={`text-purple-400 ${className}`} />;
    case 'zip':
    case 'tar':
    case 'gz':
    case 'rar':
      return <FileArchive size={size} className={`text-orange-400 ${className}`} />;
    case 'pub':
    case 'key':
    case 'pem':
      return <Key size={size} className={`text-slate-400 ${className}`} />;
    default:
      return <File size={size} className={`text-zinc-400 ${className}`} />;
  }
};
