const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else if (file.endsWith('.tsx')) {
      results.push(file);
    }
  });
  return results;
}

const dirs = [
  'd:/POS/Duro_POS/frontend/src/screens/shop',
  'd:/POS/Duro_POS/frontend/src/components/ui',
  'd:/POS/Duro_POS/frontend/src/components/shop'
];

let files = [];
dirs.forEach(d => {
  if(fs.existsSync(d)) files = files.concat(walk(d));
});

files.forEach(file => {
  if (file.includes('shop-text.tsx')) return;
  
  let content = fs.readFileSync(file, 'utf8');
  if (!content.includes('react-native')) return;
  
  let modified = false;
  
  content = content.replace(/import\s+\{([^}]+)\}\s+from\s+[\"']react-native[\"'];/g, (match, importsStr) => {
    const imports = importsStr.split(',').map(s => s.trim()).filter(Boolean);
    if (imports.includes('Text')) {
      modified = true;
      const newImports = imports.filter(i => i !== 'Text');
      if (newImports.length > 0) {
        return 'import { ' + newImports.join(', ') + ' } from "react-native";';
      } else {
        return '';
      }
    }
    return match;
  });

  if (modified) {
    const newImport = 'import { ShopText as Text } from "@/components/ui/shop-text";\n';
    
    // Find last import
    const lastImportIndex = content.lastIndexOf('import ');
    if (lastImportIndex !== -1) {
      const endOfLine = content.indexOf('\n', lastImportIndex);
      content = content.slice(0, endOfLine + 1) + newImport + content.slice(endOfLine + 1);
    } else {
      content = newImport + content;
    }
    
    fs.writeFileSync(file, content, 'utf8');
    console.log('Updated: ' + file);
  }
});
