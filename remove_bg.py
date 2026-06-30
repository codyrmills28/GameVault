from PIL import Image

def remove_background(input_path, output_path, threshold=25):
    img = Image.open(input_path).convert("RGBA")
    datas = img.getdata()

    newData = []
    for item in datas:
        # If pixel is close to black, make it transparent
        # item is (R, G, B, A)
        if item[0] < threshold and item[1] < threshold and item[2] < threshold:
            # We can also do alpha blending so edges are smooth, but a simple cut might work,
            # or better yet, map the lightness to alpha for a perfect screen-blend effect
            # lightness = max(item[0], item[1], item[2])
            # newData.append((item[0], item[1], item[2], lightness))
            newData.append((255, 255, 255, 0))
        else:
            # Keep the pixel, but let's do a smooth alpha based on how far from black it is to avoid jagged edges
            lightness = max(item[0], item[1], item[2])
            # We want the color to stay intact but the alpha to fade out at the edges
            # For a pure black background, the color IS the alpha essentially (screen blending)
            # We'll use the maximum color channel as the alpha, and then divide the RGB by alpha to un-premultiply
            if lightness == 0:
                newData.append((0, 0, 0, 0))
            else:
                alpha = lightness
                # To prevent it from looking washed out, we don't un-premultiply entirely, 
                # but this gives a nice transparent glow effect!
                newData.append((item[0], item[1], item[2], alpha))

    img.putdata(newData)
    img.save(output_path, "PNG")

remove_background(
    r"C:\Users\Cody\.gemini\antigravity\brain\3b8c4802-ab00-4de8-a7f2-d4bd994903f8\simple_treasure_chest_1782782930991.png",
    r"C:\Users\Cody\GameVault\public\vault-empty.png"
)
