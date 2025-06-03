import style from './components/assets/App.module.css'
import Prompt from './components/Prompt.jsx'
function App() {
  console.log('VITE_BACKEND_URL =', import.meta.env.VITE_BACKEND_URL);
  console.log('import.meta.env =', import.meta.env);
  return (
    <div className={style.appContainer}>
      <div className={style.app}>
        <h1 className={style.head}>IGen</h1>
        <p className={style.tail}>Enter prompt to generate</p>
        <Prompt/>
      </div>
    </div>
  )
}

export default App
