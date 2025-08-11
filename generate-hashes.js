// generate-hashes.js
const fs = require('fs').promises;
const path = require('path');
// 1. Import the entire module object
const jimp = require('jimp');

async function generate() {
  const imageDir = path.join(__dirname, 'master-images');
  const files = await fs.readdir(imageDir);
  const hashes = {};

  console.log(`Found ${files.length} images to process...`);

  for (const file of files) {
    try {
      const filePath = path.join(imageDir, file);
      
      // 2. Access the Jimp class on the module, then call the static .read() method
      const image = await jimp.Jimp.read(filePath);
      
      const hash = image.pHash();
      
      hashes[file] = hash;
      console.log(`- Generated hash for ${file}: ${hash}`);
    } catch (error) {
      console.error(`\nError processing ${file}:`, error.message);
    }
  }

  if (Object.keys(hashes).length > 0) {
    await fs.writeFile('master-hashes.json', JSON.stringify(hashes, null, 2));
    console.log('\nSuccessfully created master-hashes.json!');
  } else {
    console.log('\nNo hashes were generated. Please check for errors above.');
  }
}

generate();

