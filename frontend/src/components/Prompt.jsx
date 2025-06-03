import axios from 'axios'
import React, { useState, useEffect } from "react";
import style from './assets/Prompt.module.css'

function Prompt(){

    const [prompt, setPrompt] = useState("");
    const [image, setImage] = useState(null);
    const [loading, setLoading] = useState(false);
    const backendUrl = import.meta.env.VITE_BACKEND_URL;

    async function generate(){
        setLoading(true);
        
        try{
            const response = await axios.post(`http://localhost:8000/api/igen/generate`, { prompt: prompt });

            if (response.data.image){
                setImage(`data:image/png;base64,${response.data.image}`);
            }
        }
        catch(error){
            console.error("Error generating image:", error);
        }
        setLoading(false);
    }

    return (
        <>
            <div className={style.promptContainer}>
                <input className={style.promptInput} type="text"  placeholder="Enter a prompt..." onChange = {(e) => setPrompt(e.target.value)}></input>
                <button className={style.promptButton} onClick = {generate} disabled={loading}>{loading ? "Generating..." : "Generate"}</button>
            </div>
            {image && <img  className={style.generatedImage} src={image} alt={prompt}/>}
        </>
    )
}

export default Prompt;