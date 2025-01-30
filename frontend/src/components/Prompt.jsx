import React from "react"
import { useState } from 'react'
import style from './assets/Prompt.module.css'

function Prompt(){

    const [prompt, setPrompt] = useState("");

    function generate(){
        console.log(prompt);
    }

    return (
        <div className={style.promptContainer}>
            <input className={style.promptInput} type="text" onChange = {(e) => setPrompt(e.target.value)}></input>
            <button className={style.promptButton} onClick = {generate}>Generate</button>
        </div>
    )
}

export default Prompt;