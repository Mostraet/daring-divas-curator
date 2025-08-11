// download-images.js
require('dotenv').config();
const { Alchemy, Network } = require('alchemy-sdk');
const Jimp = require('jimp');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

// --- CONFIGURATION ---
const DARING_DIVAS_CONTRACT = '0xD127d434266eBF4CB4F861071ebA50A799A23d9d';
const OUTPUT_DIR = path.join(__dirname, 'minted-images');

async function downloadNewImages() {
  console.log('Starting image downloader...');

  // 1. Check which images we already have
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const existingFiles = await fs.readdir(OUTPUT_DIR);
  // Create a Set of existing token IDs for fast lookups
  const existingTokenIds = new Set(
    existingFiles.map(file => {
      // Extracts the token ID number from a filename like "token-29.jpg"
      const match = file.match(/token-(\d+)\.jpg/);
      return match ? match[1] : null;
    }).filter(id => id !== null)
  );
  console.log(`Found ${existingTokenIds.size} images already downloaded.`);

  // 2. Initialize Alchemy and start scanning the collection
  const alchemy = new Alchemy({
    apiKey: process.env.ALCHEMY_API_KEY,
    network: Network.BASE_MAINNET,
  });

  console.log('Fetching all NFTs from the contract to find new images...');
  let newImagesDownloaded = 0;

  // 3. Loop through every NFT in the collection
  for await (const nft of alchemy.nft.getNftsForContractIterator(DARING_DIVAS_CONTRACT)) {
    const tokenId = nft.tokenId;

    // 4. If we already have this token's image, skip to the next one
    if (existingTokenIds.has(tokenId)) {
      continue;
    }

    // This is a new token we haven't downloaded yet.
    console.log(`- Found new token #${tokenId}. Processing...`);
    try {
      // Perform the proven two-step fetch to get the real image URL
      if (!nft.tokenUri) {
        console.log(`  - Skipping token #${tokenId}: No tokenUri found.`);
        continue;
      }
      const metadataResponse = await axios.get(nft.tokenUri);
      const imageUrl = metadataResponse.data.image;
      if (!imageUrl) {
        console.log(`  - Skipping token #${tokenId}: No image in metadata.`);
        continue;
      }

      // Download the image and save it
      const image = await Jimp.Jimp.read(imageUrl);
      const savePath = path.join(OUTPUT_DIR, `token-${tokenId}.jpg`);
      await image.write(savePath);
      console.log(`  ✅ Successfully downloaded and saved to ${savePath}`);
      newImagesDownloaded++;

    } catch (error) {
      console.error(`  ❌ Failed to process token #${tokenId}:`, error.message);
    }
  }

  console.log('\n--- Download Complete ---');
  if (newImagesDownloaded > 0) {
    console.log(`Successfully downloaded ${newImagesDownloaded} new images.`);
  } else {
    console.log('No new images to download. Your archive is up to date!');
  }
}

// Run the main function
downloadNewImages().catch(error => {
  console.error('\nAn unexpected error occurred during the download process:', error);
});

