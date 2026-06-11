import folderIcon from '~icons/bi/folder-fill?raw'
import yamlFileIcon from '~icons/tdesign/file-yaml?raw'
import fileIcon from '~icons/vscode-icons/default-file?raw'

// Common file types
import pyIcon from '~icons/vscode-icons/file-type-python?raw'
import jsIcon from '~icons/vscode-icons/file-type-js-official?raw'
import tsIcon from '~icons/vscode-icons/file-type-typescript-official?raw'
import htmlIcon from '~icons/vscode-icons/file-type-html?raw'
import cssIcon from '~icons/vscode-icons/file-type-css?raw'
import jsonIcon from '~icons/vscode-icons/file-type-json?raw'
import mdIcon from '~icons/vscode-icons/file-type-markdown?raw'
import gitIcon from '~icons/vscode-icons/file-type-git?raw'
import vueIcon from '~icons/vscode-icons/file-type-vue?raw'
import reactIcon from '~icons/vscode-icons/file-type-reactjs?raw'
import sassIcon from '~icons/vscode-icons/file-type-sass?raw'
import npmIcon from '~icons/vscode-icons/file-type-npm?raw'
import nodeIcon from '~icons/vscode-icons/file-type-node?raw'
import dockerIcon from '~icons/vscode-icons/file-type-docker?raw'
import rustIcon from '~icons/vscode-icons/file-type-rust?raw'
import goIcon from '~icons/vscode-icons/file-type-go?raw'
import cppIcon from '~icons/vscode-icons/file-type-cpp?raw'
import cIcon from '~icons/vscode-icons/file-type-c?raw'
import javaIcon from '~icons/vscode-icons/file-type-java?raw'
import phpIcon from '~icons/vscode-icons/file-type-php?raw'
import sqlIcon from '~icons/vscode-icons/file-type-sql?raw'
import xmlIcon from '~icons/vscode-icons/file-type-xml?raw'
import editorconfigIcon from '~icons/vscode-icons/file-type-editorconfig?raw'
import eslintIcon from '~icons/vscode-icons/file-type-eslint?raw'
import prettierIcon from '~icons/vscode-icons/file-type-prettier?raw'
import viteIcon from '~icons/vscode-icons/file-type-vite?raw'
import webpackIcon from '~icons/vscode-icons/file-type-webpack?raw'
import tailwindIcon from '~icons/vscode-icons/file-type-tailwind?raw'
import envIcon from '~icons/vscode-icons/file-type-dotenv?raw'
import licenseIcon from '~icons/vscode-icons/file-type-license?raw'
import settingsIcon from '~icons/vscode-icons/file-type-config?raw'
import imageIcon from '~icons/vscode-icons/file-type-image?raw'
import pdfIcon from '~icons/vscode-icons/file-type-pdf2?raw'
import zipIcon from '~icons/vscode-icons/file-type-zip?raw'
import textIcon from '~icons/vscode-icons/file-type-text?raw'

const iconMap = {
    // Folders
    '_folder': folderIcon,
    '_file': fileIcon,

    // Extensions
    'py': pyIcon,
    'js': jsIcon,
    'ts': tsIcon,
    'html': htmlIcon,
    'css': cssIcon,
    'json': jsonIcon,
    'md': mdIcon,
    'gitignore': gitIcon,
    'gitconfig': gitIcon,
    'vue': vueIcon,
    'jsx': reactIcon,
    'tsx': reactIcon,
    'scss': sassIcon,
    'sass': sassIcon,
    'less': sassIcon,
    'rs': rustIcon,
    'go': goIcon,
    'cpp': cppIcon,
    'c': cIcon,
    'h': cIcon,
    'java': javaIcon,
    'php': phpIcon,
    'sql': sqlIcon,
    'xml': xmlIcon,
    'yaml': yamlFileIcon,
    'yml': yamlFileIcon,
    'env': envIcon,
    'png': imageIcon,
    'jpg': imageIcon,
    'jpeg': imageIcon,
    'gif': imageIcon,
    'svg': imageIcon,
    'pdf': pdfIcon,
    'zip': zipIcon,
    'tar': zipIcon,
    'gz': zipIcon,
    'txt': textIcon,
    
    // Special files
    'package.json': npmIcon,
    'package-lock.json': npmIcon,
    'node_modules': nodeIcon,
    'dockerfile': dockerIcon,
    'docker-compose.yml': dockerIcon,
    '.editorconfig': editorconfigIcon,
    '.eslintrc': eslintIcon,
    '.eslintrc.js': eslintIcon,
    '.eslintrc.json': eslintIcon,
    '.prettierrc': prettierIcon,
    '.env': envIcon,
    'readme.md': mdIcon,
    'license': licenseIcon,
    'license.md': licenseIcon,
    'license.txt': licenseIcon,
    'vite.config.js': viteIcon,
    'vite.config.ts': viteIcon,
    'webpack.config.js': webpackIcon,
    'tailwind.config.js': tailwindIcon,
    'config.js': settingsIcon,
    'config.json': settingsIcon,
};

export function getFileIcon(name, isDirectory, isOpen) {
    if (isDirectory) {
        return iconMap._folder;
    }

    // Check full name first (for special files like package.json)
    if (iconMap[name.toLowerCase()]) {
        return iconMap[name.toLowerCase()];
    }

    // Check extension
    const ext = name.split('.').pop().toLowerCase();
    return iconMap[ext] || iconMap._file;
}
